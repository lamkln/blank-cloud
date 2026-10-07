import { randomUUID } from "node:crypto";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import { createLanguageModel } from "../providers/model.js";
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

const SYSTEM = `You are blank-cloud, a self-hosted coding agent similar to Cursor Cloud Agent.
You operate inside a Linux container on the user's git workspace (cloned remote or mounted repo).

Behavior:
- Explore the codebase with list_directory and read_file before editing.
- After each tool call, write a short update to the user in plain language (they only see chat, not raw tool JSON).
- When ready to modify files, call propose_changes with FULL file contents for each changed file (paths relative to workspace root).
- Optional: include shell commands to run after the user approves (tests, lint, build).
- After calling propose_changes, STOP and wait. The user must approve or reject in the UI.
- If the user rejects or sends follow-up messages, revise your approach.

Prefer minimal, correct changes. Do not run shell commands yourself except via proposed commands after approval.`;

const AGENT_TURN_TIMEOUT_MS = Number(process.env.BLANK_CLOUD_AGENT_TIMEOUT_MS) || 15 * 60 * 1000;

function agentStreamingEnabled(): boolean {
  return process.env.BLANK_CLOUD_AGENT_STREAM === "1";
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
  return {
    list_directory: tool({
      description: "List entries in a directory relative to the workspace root",
      parameters: z.object({
        path: z.string().describe('Directory path, use "." for workspace root'),
      }),
      execute: async ({ path: dirPath }) => {
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

function withAgentTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent timed out after ${Math.round(AGENT_TURN_TIMEOUT_MS / 60000)} minutes`));
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

async function runStreamingTurn(taskId: string, task: TaskRecord): Promise<void> {
  let streamId = randomUUID();
  let segmentText = "";
  let step = 0;

  const result = streamText({
    model: createLanguageModel(),
    system: SYSTEM,
    messages: modelMessages(task),
    maxSteps: 16,
    tools: buildTools(taskId),
    onChunk: ({ chunk }) => {
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
    onStepFinish: () => {
      step += 1;
      emitStepProgress(taskId, step);
      const trimmed = segmentText.trim();
      if (trimmed) {
        appendTaskMessage(taskId, "assistant", trimmed, true);
      }
      segmentText = "";
      streamId = randomUUID();
    },
  });

  await withAgentTimeout(result.text);
  await finishAgentTurn(taskId);
}

async function runBatchTurn(taskId: string, task: TaskRecord): Promise<void> {
  let step = 0;
  const result = await withAgentTimeout(
    generateText({
      model: createLanguageModel(),
      system: SYSTEM,
      messages: modelMessages(task),
      maxSteps: 16,
      tools: buildTools(taskId),
      onStepFinish: () => {
        step += 1;
        emitStepProgress(taskId, step);
      },
    }),
  );

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
        rollbackMessagesSince(taskId, messageCountAtStart);
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
