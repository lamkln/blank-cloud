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
  | "reasoning_delta"
  | "log"
  | "tool"
  | "proposal"
  | "plan"
  | "awaiting_approval"
  | "rejected"
  | "command_stdout"
  | "command_stderr"
  | "command_exit"
  | "applied"
  | "undone"
  | "status"
  | "error"
  | "done"
  | "verify";

export type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TaskPlanStep {
  id: string;
  title: string;
  filesHint?: string;
  status: PlanStepStatus;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface TaskPlan {
  steps: TaskPlanStep[];
  currentStepIndex: number;
  compactSummary: string;
}

export interface TaskRunOptions {
  autoApprove?: boolean;
  /** When true with autoApprove, ignore workspace newFilesOnly and pathPrefix. */
  autoApproveRelaxRules?: boolean;
  autoApproveAllowShell?: boolean;
  referenceFiles?: string[];
  template?: string;
}

export interface TaskRuntimeControls {
  cancelRequested: boolean;
  modelWaitStartedAt: string | null;
  activeProvider: string | null;
  activeModel: string | null;
  currentPhase: string | null;
  verifyAttempts: number;
  lastAutoApproveReason: string | null;
  filesWritten: number;
}

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
  plan: TaskPlan | null;
  options: TaskRunOptions;
  controls: TaskRuntimeControls;
}

export interface CreateTaskInput {
  prompt: string;
}
