import type { TaskRecord } from "./types.js";
import { readWorkspaceFile } from "../workspace/paths.js";
import type { PendingProposal } from "./types.js";

export function enrichProposal(proposal: PendingProposal): PendingProposal {
  return {
    ...proposal,
    files: proposal.files.map((file) => {
      let previousContent: string | null = null;
      try {
        previousContent = readWorkspaceFile(file.path);
      } catch {
        previousContent = null;
      }
      return {
        ...file,
        previousContent,
        isNew: previousContent === null,
      };
    }),
  };
}

export function taskProgressSummary(task: TaskRecord) {
  const step = task.plan?.steps[task.plan.currentStepIndex];
  return {
    status: task.status,
    planStep: task.plan ? task.plan.currentStepIndex + 1 : null,
    planSteps: task.plan?.steps.length ?? null,
    currentStepTitle: step?.title ?? null,
    stepDurationMs: step?.durationMs ?? null,
    filesWritten: task.controls?.filesWritten ?? 0,
    lastError: task.lastError,
    lastAutoApproveReason: task.controls?.lastAutoApproveReason ?? null,
    pendingFiles: task.pendingProposal?.files.length ?? 0,
  };
}

export function taskToJson(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    prompt: task.prompt,
    messages: task.messages,
    pendingProposal: task.pendingProposal ? enrichProposal(task.pendingProposal) : null,
    lastError: task.lastError,
    iteration: task.iteration,
    canUndo: task.undoStack.length > 0,
    plan: task.plan,
    controls: task.controls,
    options: task.options,
    progress: taskProgressSummary(task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
