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
  previousContent?: string | null;
  isNew?: boolean;
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

export type ChatRole = "user" | "assistant";

export interface TaskMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export type TaskEventType =
  | "message"
  | "message_delta"
  | "log"
  | "tool"
  | "proposal"
  | "awaiting_approval"
  | "rejected"
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
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  messages: TaskMessage[];
  pendingProposal: PendingProposal | null;
  undoStack: UndoSnapshot[];
  lastError: string | null;
  iteration: number;
  /** GitHub login when per-user OAuth is enabled */
  ownerLogin: string | null;
}

export interface CreateTaskInput {
  prompt: string;
}
