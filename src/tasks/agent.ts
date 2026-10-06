import { generateText, tool } from "ai";
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
- Explain your plan briefly in natural language as you work (the user sees a chat UI).
- When ready to modify files, call propose_changes with FULL file contents for each changed file (paths relative to workspace root).
- Optional: include shell commands to run after the user approves (tests, lint, build).
- After calling propose_changes, STOP and wait. The user must approve or reject in the UI.
- If the user rejects or sends follow-up messages, revise your approach.

Prefer minimal, correct changes. Do not run shell commands yourself except via proposed commands after approval.`;

export async function runAgentTurn(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    return;
  }

  updateTask(taskId, {
    status: "running",
    iteration: task.iteration + 1,
  });
  emit(taskId, "status", "Agent working…", { status: "running", iteration: task.iteration + 1 });

  try {
    const result = await generateText({
      model: createLanguageModel(),
      system: SYSTEM,
      messages: task.messages.map((m) => ({ role: m.role, content: m.content })),
      maxSteps: 16,
      tools: buildTools(taskId),
    });

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

    updateTask(taskId, { status: "completed" });
    emit(taskId, "done", "Run finished", { status: "completed" });
  } catch (err) {
    const message = formatAgentError(err, { provider: getRuntimeSettings().provider });
    updateTask(taskId, { status: "failed", lastError: message });
    emit(taskId, "error", message, { status: "failed" });
  }
}

function buildTools(taskId: string) {
  return {
    list_directory: tool({
      description: "List entries in a directory relative to the workspace root",
      parameters: z.object({
        path: z.string().describe('Directory path, use "." for workspace root'),
      }),
      execute: async ({ path: dirPath }) => {
        emit(taskId, "tool", `Listed ${dirPath}`, {
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
        emit(taskId, "tool", `Read ${filePath}`, { tool: "read_file", path: filePath });
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
