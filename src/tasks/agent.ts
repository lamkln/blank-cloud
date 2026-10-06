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
import { emit, getTask, updateTask } from "./store.js";
import type { TaskRecord } from "./types.js";

const SYSTEM = `You are blank-cloud, a self-hosted coding agent operating inside a Linux container.
The user's project is mounted at the workspace root. Use tools to inspect files before changing anything.

Workflow:
1. Read and list files to understand the codebase.
2. When ready to change code, call propose_changes with full file contents for each edited file (paths relative to workspace root).
3. Optionally include shell commands to run after the user approves (tests, builds). Do not assume commands ran until approval.
4. After proposing, stop and wait — do not call propose_changes again until the user approves or rejects.

Be concise in summaries. Prefer minimal, correct diffs via complete file contents.`;

export async function runAgentTurn(taskId: string, userMessage: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    return;
  }

  updateTask(taskId, {
    status: "running",
    iteration: task.iteration + 1,
  });
  emit(taskId, "status", "Agent thinking", { status: "running", iteration: task.iteration + 1 });

  try {
    const result = await generateText({
      model: createLanguageModel(),
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage }],
      maxSteps: 12,
      tools: buildTools(taskId),
      onStepFinish: (step) => {
        if (step.text?.trim()) {
          emit(taskId, "log", step.text.trim());
        }
      },
    });

    const refreshed = getTask(taskId);
    if (refreshed?.pendingProposal) {
      return;
    }

    if (result.text?.trim()) {
      emit(taskId, "log", result.text.trim());
    }

    updateTask(taskId, { status: "completed" });
    emit(taskId, "done", "Task finished without pending changes", { status: "completed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
        emit(taskId, "tool", `list_directory ${dirPath}`, { tool: "list_directory", path: dirPath });
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
        emit(taskId, "tool", `read_file ${filePath}`, { tool: "read_file", path: filePath });
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
        emit(taskId, "tool", "propose_changes", {
          tool: "propose_changes",
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
          message: "Proposal recorded. User must POST /tasks/:id/approve to apply.",
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

export function buildFailureContinuationPrompt(
  task: TaskRecord,
  error: string,
): string {
  return [
    `Original task: ${task.prompt}`,
    "",
    "After approval, execution failed:",
    error,
    "",
    "Inspect the workspace and propose a fix with propose_changes.",
  ].join("\n");
}
