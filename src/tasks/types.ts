export type TaskStatus =
  | "running"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface FileChange {
  path: string;
  content: string;
}

export interface PendingProposal {
  summary: string;
  files: FileChange[];
  commands: string[];
  createdAt: string;
}

export interface UndoSnapshot {
  proposalId: string;
  files: { path: string; existed: boolean; content: string | null }[];
  appliedAt: string;
}

export type TaskEventType =
  | "log"
  | "tool"
  | "proposal"
  | "awaiting_approval"
  | "command_stdout"
  | "command_stderr"
  | "command_exit"
  | "applied"
  | "undone"
  | "status"
  | "error"
  | "done";

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  pendingProposal: PendingProposal | null;
  undoStack: UndoSnapshot[];
  lastError: string | null;
  iteration: number;
}

export interface CreateTaskInput {
  prompt: string;
}
