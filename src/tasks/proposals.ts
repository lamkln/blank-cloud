import { randomUUID } from "node:crypto";
import {
  restoreSnapshot,
  snapshotFile,
  writeWorkspaceFile,
} from "../workspace/paths.js";
import { emit, getTask, updateTask } from "./store.js";
import type { PendingProposal, UndoSnapshot } from "./types.js";
import { explainAutoApproveDenial } from "./auto-approve.js";
import { tryAutoApprove } from "./approve-flow.js";

export function applyProposal(taskId: string): UndoSnapshot {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const proposal = task.pendingProposal;
  if (!proposal) {
    throw new Error("No pending proposal to apply");
  }

  const snapshots = proposal.files.map((f) => snapshotFile(f.path));
  for (const file of proposal.files) {
    writeWorkspaceFile(file.path, file.content);
  }

  const undo: UndoSnapshot = {
    proposalId: randomUUID(),
    files: snapshots,
    appliedAt: new Date().toISOString(),
  };

  updateTask(taskId, {
    undoStack: [...task.undoStack, undo],
    pendingProposal: null,
    status: "executing",
    controls: {
      ...task.controls,
      filesWritten: (task.controls?.filesWritten ?? 0) + proposal.files.length,
    },
  });

  emit(taskId, "applied", proposal.summary, {
    files: proposal.files.map((f) => f.path),
    undoId: undo.proposalId,
  });

  return undo;
}

export function undoLastApply(taskId: string): UndoSnapshot | null {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (task.undoStack.length === 0) {
    return null;
  }
  const stack = [...task.undoStack];
  const last = stack.pop()!;
  for (const entry of last.files) {
    restoreSnapshot(entry);
  }
  updateTask(taskId, { undoStack: stack });
  emit(taskId, "undone", "Reverted last applied changes", {
    undoId: last.proposalId,
    files: last.files.map((f) => f.path),
  });
  return last;
}

export function setPendingProposal(taskId: string, proposal: PendingProposal): void {
  updateTask(taskId, {
    pendingProposal: proposal,
    status: "awaiting_approval",
  });
  emit(taskId, "proposal", proposal.summary, {
    files: proposal.files.map((f) => ({ path: f.path, bytes: f.content.length })),
    commands: proposal.commands,
  });
  emit(taskId, "awaiting_approval", "Waiting for POST /tasks/:id/approve", {
    status: "awaiting_approval",
  });

  const task = getTask(taskId);
  if (task) {
    const reason = explainAutoApproveDenial(task, proposal);
    if (reason) {
      updateTask(taskId, {
        controls: { ...task.controls, lastAutoApproveReason: reason },
      });
      emit(taskId, "log", reason, { autoApprove: false });
    } else {
      updateTask(taskId, {
        controls: { ...task.controls, lastAutoApproveReason: null },
      });
    }
  }

  queueMicrotask(() => {
    void tryAutoApprove(taskId);
  });
}
