import { randomUUID } from "node:crypto";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import { createLanguageModel } from "../providers/model.js";
import { logAgentTask } from "./agent-log.js";
import {
  listDirectory,
  readWorkspaceFile,
  resolveWorkspacePath,
  WorkspacePathError,
} from "../workspace/paths.js";
import { setPendingProposal } from "./proposals.js";
import { appendTaskMessage, emit, getTask, updateTask } from "./store.js";
import type { TaskRecord } from "./types.js";
import { getRuntimeSettings } from "../config.js";
import { formatAgentError } from "../agent/errors.js";
import { runShellCommand } from "./runner.js";
import { agentShellEnabled, assertShellCommandAllowed } from "./shell-policy.js";

const SYSTEM = `You are blank-cloud, a self-hosted coding agent similar to Cursor Cloud Agent.
You operate inside a Linux container on the user's git workspace (cloned remote or mounted repo).

Behavior:
- Explore the codebase with list_directory and read_file before editing.
- After each tool call, write a short update to the user in plain language (they only see chat, not raw tool JSON).
- Use run_shell to run terminal commands inside the repo (npm test, git status, rm paths under the project, etc.). Output appears in the chat terminal. Stay inside the workspace.
- When ready to modify files, call propose_changes with FULL file contents for each changed file (paths relative to workspace root).
- You may also attach shell commands to propose_changes; those run only after the user clicks Accept (good for long test suites).
- After calling propose_changes, STOP and wait. The user must approve or reject in the UI.
- If the user rejects or sends follow-up messages, revise your approach.

Prefer minimal, correct changes. Use run_shell for immediate commands; use propose_changes commands for steps that should run together after a file diff is accepted.`;

const AGENT_TURN_TIMEOUT_MS = Number(process.env.BLANK_CLOUD_AGENT_TIMEOUT_MS) || 15 * 60 * 1000;
const AGENT_FIRST_RESPONSE_MS =
  Number(process.env.BLANK_CLOUD_AGENT_FIRST_RESPONSE_MS) || 60 * 1000;

const FIRST_PROGRESS_CHUNK_TYPES = new Set([
  "text-delta",
  "reasoning",
  "tool-call",
  "tool-result",
  "step-finish",
  "finish",
]);

function agentStreamingEnabled(): boolean {
  const raw = process.env.BLANK_CLOUD_AGENT_STREAM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }
  return true;
}

function modelMessages(task: TaskRecord) {
  return task.messages.map((m) => ({ role: m.role, content: m.content }));
}

function displayPath(rel: string): string {
  const p = rel.trim() || ".";
  if (p === "." || p === "./") return "project root";
  return p;
}

function emitStepProgress(taskId: string, step: number): void {
  const message =
    step <= 1 ? "Exploring repository…" : step === 2 ? "Reading files…" : "Still working…";
  emit(taskId, "status", message, { status: "running", step });
}

function buildTools(taskId: string) {
  const base = {
    list_directory: tool({
      description: "List entries in a directory relative to the workspace root",
      parameters: z.object({
        path: z.string().describe('Directory path, use "." for workspace root'),
      }),
      execute: async ({ path: dirPath }) => {
        logAgentTask(taskId, "Tool list_directory", { path: dirPath });
        emit(taskId, "tool", `Listed files in ${displayPath(dirPath)}`, {
          tool: "list_directory",
          path: dirPath,
        });
        try {
          const entries = listDirectory(dirPath);
          return { entries };
        } catch (e) {
          return { error: formatPathError(e) };
        }
      },
    }),

    read_file: tool({
      description: "Read a UTF-8 text file relative to the workspace root",
      parameters: z.object({
        path: z.string(),
      }),
      execute: async ({ path: filePath }) => {
        logAgentTask(taskId, "Tool read_file", { path: filePath });
        emit(taskId, "tool", `Read file ${displayPath(filePath)}`, {
          tool: "read_file",
          path: filePath,
        });
        try {
          const content = readWorkspaceFile(filePath);
          return { path: filePath, content };
        } catch (e) {
          return { error: formatPathError(e) };
        }
      },
    }),

    propose_changes: tool({
      description:
        "Propose file writes and optional post-approval shell commands; waits for user approval",
      parameters: z.object({
        summary: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            content: z.string(),
          }),
        ),
        commands: z.array(z.string()).default([]),
      }),
      execute: async ({ summary, files, commands }) => {
        logAgentTask(taskId, "Tool propose_changes", {
          summary,
          fileCount: files.length,
        });
        emit(taskId, "tool", `Proposed changes (${files.length} file(s))`, {
          tool: "propose_changes",
          summary,
          fileCount: files.length,
          commandCount: commands.length,
        });
        for (const f of files) {
          try {
            resolveWorkspacePath(f.path);
          } catch (e) {
            return { error: formatPathError(e) };
          }
        }

        setPendingProposal(taskId, {
          summary,
          files,
          commands: commands ?? [],
          createdAt: new Date().toISOString(),
        });
        return {
          status: "awaiting_approval",
          message: "Waiting for user approval in the UI.",
        };
      },
    }),
  };

  if (!agentShellEnabled()) {
    return base;
  }

  return {
    ...base,
    run_shell: tool({
      description:
        "Run one shell command in the project root (workspace). Use for git, npm, rm, mkdir, etc. inside the repo. Streams stdout/stderr to the user.",
      parameters: z.object({
        command: z.string().describe("Single shell command, run with bash -lc in the workspace"),
        reason: z.string().optional().describe("Short note shown in the UI"),
      }),
      execute: async ({ command, reason }) => {
        try {
          assertShellCommandAllowed(command);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
        const label = reason?.trim() || command.trim();
        emit(taskId, "tool", `Shell: ${label}`, { tool: "run_shell", command });
        const result = await runShellCommand(taskId, command);
        return {
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          ok: result.exitCode === 0 && !result.timedOut,
        };
      },
    }),
  };
}

function rollbackMessagesSince(taskId: string, messageCountAtStart: number): void {
  const task = getTask(taskId);
  if (!task || task.messages.length <= messageCountAtStart) {
    return;
  }
  updateTask(taskId, { messages: task.messages.slice(0, messageCountAtStart) });
}

async function finishAgentTurn(taskId: string): Promise<void> {
  const refreshed = getTask(taskId);
  if (refreshed?.pendingProposal) {
    return;
  }

  updateTask(taskId, { status: "completed" });
  emit(taskId, "status", "Done", { status: "completed" });
  emit(taskId, "done", "Run finished", { status: "completed" });
}

function withAgentTimeout<T>(promise: Promise<T>, label = "Agent"): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(AGENT_TURN_TIMEOUT_MS / 60000)} minutes`,
        ),
      );
    }, AGENT_TURN_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function createFirstProgressWaiter(taskId: string, mode: "stream" | "batch") {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveFn: () => void = () => {};

  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const seconds = Math.round(AGENT_FIRST_RESPONSE_MS / 1000);
      reject(
        new Error(
          `No model response within ${seconds}s (${mode} mode). Check provider/model, API key, and try BLANK_CLOUD_AGENT_STREAM=0.`,
        ),
      );
    }, AGENT_FIRST_RESPONSE_MS);
  });

  const signal = (reason: string) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    logAgentTask(taskId, `First model progress (${mode}): ${reason}`);
    resolveFn();
  };

  return { promise, signal };
}

function buildAgentGenerateOptions(
  taskId: string,
  task: TaskRecord,
  stepRef: { value: number },
  signalFirst: (reason: string) => void,
) {
  return {
    model: createLanguageModel(),
    system: SYSTEM,
    messages: modelMessages(task),
    maxSteps: 16,
    toolCallStreaming: false,
    tools: buildTools(taskId),
    onStepFinish: (stepResult: { toolCalls?: unknown[]; text?: string }) => {
      stepRef.value += 1;
      const step = stepRef.value;
      emitStepProgress(taskId, step);
      logAgentTask(taskId, `Step ${step} finished`, {
        toolCalls: stepResult.toolCalls?.length ?? 0,
        textChars: stepResult.text?.length ?? 0,
      });
      signalFirst(`step-${step}`);
    },
  };
}

async function runStreamingTurn(taskId: string, task: TaskRecord): Promise<void> {
  let streamId = randomUUID();
  let segmentText = "";
  const stepRef = { value: 0 };
  const first = createFirstProgressWaiter(taskId, "stream");
  const base = buildAgentGenerateOptions(taskId, task, stepRef, first.signal);

  logAgentTask(taskId, "Starting streaming agent turn");

  const result = streamText({
    ...base,
    onChunk: ({ chunk }) => {
      if (FIRST_PROGRESS_CHUNK_TYPES.has(chunk.type)) {
        first.signal(chunk.type);
      }
      if (chunk.type !== "text-delta") {
        return;
      }
      segmentText += chunk.textDelta;
      emit(
        taskId,
        "message_delta",
        segmentText,
        { role: "assistant", streamId },
        { persist: false },
      );
    },
    onStepFinish: (stepResult) => {
      base.onStepFinish(stepResult);
      const trimmed = segmentText.trim();
      if (trimmed) {
        appendTaskMessage(taskId, "assistant", trimmed, true);
      }
      segmentText = "";
      streamId = randomUUID();
    },
    onError: ({ error }) => {
      const message = error instanceof Error ? error.message : String(error);
      logAgentTask(taskId, "Model stream error", { error: message });
    },
  });

  void result.consumeStream();
  await Promise.race([first.promise, result.text]);
  await withAgentTimeout(result.text, "Streaming agent");
  await finishAgentTurn(taskId);
}

async function runBatchTurn(taskId: string, task: TaskRecord): Promise<void> {
  const stepRef = { value: 0 };
  const first = createFirstProgressWaiter(taskId, "batch");
  logAgentTask(taskId, "Starting batch agent turn (generateText)");

  const generatePromise = generateText(
    buildAgentGenerateOptions(taskId, task, stepRef, first.signal),
  );

  await Promise.race([first.promise, generatePromise]);
  const result = await withAgentTimeout(generatePromise, "Batch agent");

  const refreshed = getTask(taskId);
  if (refreshed?.pendingProposal) {
    if (result.text?.trim()) {
      appendTaskMessage(taskId, "assistant", result.text.trim(), true);
    }
    return;
  }

  const assistantText = result.text?.trim();
  if (assistantText) {
    appendTaskMessage(taskId, "assistant", assistantText, true);
  }

  await finishAgentTurn(taskId);
}

export async function runAgentTurn(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    return;
  }

  const messageCountAtStart = task.messages.length;

  updateTask(taskId, {
    status: "running",
    iteration: task.iteration + 1,
  });
  emit(taskId, "status", "Agent working…", { status: "running", iteration: task.iteration + 1 });

  try {
    if (agentStreamingEnabled()) {
      try {
        await runStreamingTurn(taskId, getTask(taskId)!);
      } catch (streamErr) {
        const streamMessage =
          streamErr instanceof Error ? streamErr.message : String(streamErr);
        rollbackMessagesSince(taskId, messageCountAtStart);
        logAgentTask(taskId, "Streaming failed — retrying in batch mode", {
          error: streamMessage,
        });
        emit(
          taskId,
          "log",
          "Streaming mode failed for this provider — retrying in standard mode.",
        );
        const refreshed = getTask(taskId);
        if (!refreshed) {
          throw streamErr;
        }
        await runBatchTurn(taskId, refreshed);
      }
    } else {
      await runBatchTurn(taskId, getTask(taskId)!);
    }
  } catch (err) {
    const message = formatAgentError(err, { provider: getRuntimeSettings().provider });
    logAgentTask(taskId, "Agent turn failed", { error: message });
    updateTask(taskId, { status: "failed", lastError: message });
    emit(taskId, "status", "Failed", { status: "failed" });
    emit(taskId, "error", message, { status: "failed" });
  }
}

function formatPathError(e: unknown): string {
  if (e instanceof WorkspacePathError) {
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

export function buildFailureContinuationUserMessage(task: TaskRecord, error: string): string {
  return [
    `Original request: ${task.prompt}`,
    "",
    "The last approved changes were applied, but a command failed:",
    error,
    "",
    "Inspect the repo and propose a fix with propose_changes, or explain what went wrong.",
  ].join("\n");
}

export function buildRejectionUserMessage(feedback?: string): string {
  if (feedback?.trim()) {
    return `I rejected the proposed changes. Feedback: ${feedback.trim()}\nPlease try again with a different approach.`;
  }
  return "I rejected the proposed changes. Please try a different approach.";
}
