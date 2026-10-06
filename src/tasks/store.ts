import { randomUUID } from "node:crypto";
import type { ChatRole, TaskEvent, TaskRecord, TaskMessage } from "./types.js";

type Listener = (event: TaskEvent) => void;

const tasks = new Map<string, TaskRecord>();
const events = new Map<string, TaskEvent[]>();
const listeners = new Map<string, Set<Listener>>();

function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split(/\n/)[0] ?? "Task";
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

export function createTask(prompt: string): TaskRecord {
  const now = new Date().toISOString();
  const userMessage: TaskMessage = {
    id: randomUUID(),
    role: "user",
    content: prompt,
    createdAt: now,
  };
  const task: TaskRecord = {
    id: randomUUID(),
    prompt,
    title: titleFromPrompt(prompt),
    status: "running",
    createdAt: now,
    updatedAt: now,
    messages: [userMessage],
    pendingProposal: null,
    undoStack: [],
    lastError: null,
    iteration: 0,
  };
  tasks.set(task.id, task);
  events.set(task.id, []);
  listeners.set(task.id, new Set());
  emit(task.id, "status", "Agent run started", { status: task.status });
  emit(task.id, "message", prompt, { role: "user" });
  return task;
}

export function listTasks(limit = 40): TaskRecord[] {
  return Array.from(tasks.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function getTask(id: string): TaskRecord | undefined {
  return tasks.get(id);
}

export function updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  return task;
}

export function appendTaskMessage(
  taskId: string,
  role: ChatRole,
  content: string,
  emitEvent = true,
): TaskMessage {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const message: TaskMessage = {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  task.messages.push(message);
  updateTask(taskId, { messages: task.messages });
  if (emitEvent) {
    emit(taskId, "message", content, { role });
  }
  return message;
}

export function listTaskEvents(taskId: string): TaskEvent[] {
  return events.get(taskId) ?? [];
}

export function subscribe(taskId: string, listener: Listener): () => void {
  let set = listeners.get(taskId);
  if (!set) {
    set = new Set();
    listeners.set(taskId, set);
  }
  set.add(listener);
  return () => set!.delete(listener);
}

export function emit(
  taskId: string,
  type: TaskEvent["type"],
  message: string,
  data?: Record<string, unknown>,
): TaskEvent {
  const event: TaskEvent = {
    id: randomUUID(),
    taskId,
    type,
    message,
    data,
    createdAt: new Date().toISOString(),
  };
  const list = events.get(taskId);
  if (list) {
    list.push(event);
  }
  const set = listeners.get(taskId);
  if (set) {
    for (const fn of set) {
      fn(event);
    }
  }
  return event;
}
