import { randomUUID } from "node:crypto";
import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import type { ModelRole } from "../providers/model-runtime.js";
import { runWithModelFallback } from "../providers/fallback.js";
import { logAgentTask } from "./agent-log.js";
import { loadAppSettings } from "../settings/store.js";
import { getFirstResponseTimeoutMs } from "../settings/agent-settings.js";
import { buildWorkspaceContextBlock } from "./context.js";
import { assertNotCancelled, beginTaskRun, getTaskAbortSignal } from "./cancel.js";
import type { LanguageModel } from "ai";
import type { LanguageModelV1FunctionToolCall } from "@ai-sdk/provider";
import {
  listDirectory,
  readWorkspaceFile,
  resolveWorkspacePath,
  WorkspacePathError,
} from "../workspace/paths.js";
import { setPendingProposal } from "./proposals.js";
import {
  formatProposeChangesValidationError,
  normalizeFilesField,
  proposeChangesArgsSchema,
} from "./tool-args.js";
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
const turnOptions = new Map<string, AgentTurnOptions>();

export interface AgentTurnOptions {
  modelRole?: ModelRole;
  deferCompletion?: boolean;
  maxFilesPerStep?: number;
}

function firstResponseMs(): number {
  return getFirstResponseTimeoutMs(loadAppSettings().agent);
}

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

function buildTools(taskId: string, maxFilesPerStep: number) {
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
      description: `Propose file writes (1–${maxFilesPerStep} files per call). files MUST be a JSON array of objects {path, content} — never a stringified array. Full file contents required.`,
      parameters: proposeChangesArgsSchema,
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
        if (files.length > maxFilesPerStep) {
          return {
            error: `At most ${maxFilesPerStep} file(s) per step — split into another propose_changes call.`,
          };
        }
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

async function finishAgentTurn(taskId: string, deferCompletion = false): Promise<void> {
  const refreshed = getTask(taskId);
  if (refreshed?.pendingProposal) {
    return;
  }
  if (deferCompletion || refreshed?.plan) {
    emit(taskId, "status", "Step finished", { status: "running" });
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

function createFirstProgressWaiter(
  taskId: string,
  mode: "stream" | "batch",
  timeoutMs: number,
) {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveFn: () => void = () => {};

  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const seconds = Math.round(timeoutMs / 1000);
      reject(
        new Error(
          `No model response within ${seconds}s (${mode} mode). Check provider/model, API key, and try BLANK_CLOUD_AGENT_STREAM=0.`,
        ),
      );
    }, timeoutMs);
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

async function repairToolCallArgs(
  taskId: string,
  {
    toolCall,
    error,
  }: {
    toolCall: LanguageModelV1FunctionToolCall;
    error: unknown;
  },
): Promise<LanguageModelV1FunctionToolCall | null> {
  if (toolCall.toolName !== "propose_changes") {
    return null;
  }
  try {
    const raw = JSON.parse(toolCall.args) as Record<string, unknown>;
    const files = normalizeFilesField(raw.files);
    const fixed = { ...raw, files };
    logAgentTask(taskId, "Repaired propose_changes args", {
      error: error instanceof Error ? error.message : String(error),
      fileCount: files.length,
    });
    return { ...toolCall, args: JSON.stringify(fixed) };
  } catch (e) {
    logAgentTask(taskId, "propose_changes repair failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function buildAgentGenerateOptions(
  taskId: string,
  task: TaskRecord,
  stepRef: { value: number },
  signalFirst: (reason: string) => void,
  model: LanguageModel,
  maxFilesPerStep: number,
) {
  const context = buildWorkspaceContextBlock(task);
  return {
    model,
    system: `${SYSTEM}${context}`,
    messages: modelMessages(task),
    maxSteps: 16,
    maxRetries: 2,
    toolCallStreaming: false,
    abortSignal: getTaskAbortSignal(taskId),
    tools: buildTools(taskId, maxFilesPerStep),
    experimental_repairToolCall: (opts: Parameters<typeof repairToolCallArgs>[1]) =>
      repairToolCallArgs(taskId, opts),
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

async function runStreamingTurn(
  taskId: string,
  task: TaskRecord,
  model: LanguageModel,
  opts: AgentTurnOptions,
): Promise<void> {
  let streamId = randomUUID();
  let segmentText = "";
  const stepRef = { value: 0 };
  const timeoutMs = firstResponseMs();
  const first = createFirstProgressWaiter(taskId, "stream", timeoutMs);
  const maxFiles = opts.maxFilesPerStep ?? loadAppSettings().agent.maxFilesPerStep;
  const base = buildAgentGenerateOptions(
    taskId,
    task,
    stepRef,
    first.signal,
    model,
    maxFiles,
  );

  logAgentTask(taskId, "Starting streaming agent turn");
  startModelWaitTicker(taskId);

  const result = streamText({
    ...base,
    onChunk: ({ chunk }) => {
      if (FIRST_PROGRESS_CHUNK_TYPES.has(chunk.type)) {
        first.signal(chunk.type);
      }
      if (chunk.type === "reasoning") {
        emit(
          taskId,
          "reasoning_delta",
          chunk.textDelta,
          { role: "assistant" },
          { persist: false },
        );
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
  stopModelWaitTicker(taskId);
  await withAgentTimeout(result.text, "Streaming agent");
  await finishAgentTurn(taskId, opts.deferCompletion);
}

async function runBatchTurn(
  taskId: string,
  task: TaskRecord,
  model: LanguageModel,
  opts: AgentTurnOptions,
): Promise<void> {
  const stepRef = { value: 0 };
  const timeoutMs = firstResponseMs();
  const first = createFirstProgressWaiter(taskId, "batch", timeoutMs);
  const maxFiles = opts.maxFilesPerStep ?? loadAppSettings().agent.maxFilesPerStep;
  logAgentTask(taskId, "Starting batch agent turn (generateText)");
  startModelWaitTicker(taskId);

  const generatePromise = generateText(
    buildAgentGenerateOptions(taskId, task, stepRef, first.signal, model, maxFiles),
  );

  await Promise.race([first.promise, generatePromise]);
  stopModelWaitTicker(taskId);
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

  await finishAgentTurn(taskId, opts.deferCompletion);
}

const waitTickers = new Map<string, ReturnType<typeof setInterval>>();

function startModelWaitTicker(taskId: string): void {
  stopModelWaitTicker(taskId);
  const started = Date.now();
  const settings = loadAppSettings();
  updateTask(taskId, {
    controls: {
      ...getTask(taskId)!.controls,
      modelWaitStartedAt: new Date().toISOString(),
      currentPhase: "model_wait",
      activeProvider: settings.provider,
      activeModel: settings.model,
    },
  });
  const timer = setInterval(() => {
    const task = getTask(taskId);
    if (!task) return;
    const elapsedMs = Date.now() - started;
    emit(taskId, "status", "Waiting for model…", {
      phase: "model_wait",
      elapsedMs,
      elapsedSec: Math.floor(elapsedMs / 1000),
      provider: task.controls.activeProvider ?? settings.provider,
      model: task.controls.activeModel ?? settings.model,
      planStep: task.plan?.currentStepIndex,
    });
  }, 1000);
  waitTickers.set(taskId, timer);
}

function stopModelWaitTicker(taskId: string): void {
  const t = waitTickers.get(taskId);
  if (t) {
    clearInterval(t);
    waitTickers.delete(taskId);
  }
}

async function runModelTurn(taskId: string, task: TaskRecord, opts: AgentTurnOptions): Promise<void> {
  const role = opts.modelRole ?? "default";
  await runWithModelFallback(taskId, role === "default" ? "edit" : role, async (model, label) => {
    const parts = label.split("/");
    updateTask(taskId, {
      controls: {
        ...getTask(taskId)!.controls,
        activeProvider: parts[0] ?? null,
        activeModel: parts.slice(1).join("/") || null,
        currentPhase: "model",
      },
    });
    if (agentStreamingEnabled()) {
      try {
        await runStreamingTurn(taskId, getTask(taskId)!, model, opts);
      } catch (streamErr) {
        throw streamErr;
      }
    } else {
      await runBatchTurn(taskId, getTask(taskId)!, model, opts);
    }
  });
}

export async function runAgentTurnInternal(
  taskId: string,
  options: AgentTurnOptions = {},
): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    return;
  }

  const opts: AgentTurnOptions = {
    maxFilesPerStep: loadAppSettings().agent.maxFilesPerStep,
    ...options,
  };
  turnOptions.set(taskId, opts);
  beginTaskRun(taskId);

  const messageCountAtStart = task.messages.length;

  updateTask(taskId, {
    status: "running",
    iteration: task.iteration + 1,
    controls: {
      ...task.controls,
      cancelRequested: false,
      currentPhase: "agent",
    },
  });
  emit(taskId, "status", "Agent working…", {
    status: "running",
    iteration: task.iteration + 1,
  });

  try {
    assertNotCancelled(taskId);
    if (agentStreamingEnabled()) {
      try {
        await runModelTurn(taskId, getTask(taskId)!, opts);
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
        await runWithModelFallback(taskId, opts.modelRole ?? "edit", async (model) => {
          await runBatchTurn(taskId, refreshed, model, opts);
        });
      }
    } else {
      await runModelTurn(taskId, getTask(taskId)!, opts);
    }
  } catch (err) {
    if (err instanceof Error && err.message === "Task cancelled") {
      updateTask(taskId, { status: "cancelled", lastError: "Cancelled" });
      emit(taskId, "status", "Cancelled", { status: "cancelled" });
      return;
    }
    const message = formatAgentError(err, { provider: getRuntimeSettings().provider });
    logAgentTask(taskId, "Agent turn failed", { error: message });
    updateTask(taskId, { status: "failed", lastError: message });
    emit(taskId, "status", "Failed", { status: "failed" });
    emit(taskId, "error", message, { status: "failed" });
  } finally {
    turnOptions.delete(taskId);
    stopModelWaitTicker(taskId);
  }
}

export async function runAgentTurn(taskId: string): Promise<void> {
  const { runTaskOrchestrator } = await import("./orchestrator.js");
  await runTaskOrchestrator(taskId);
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
