import { randomUUID } from "node:crypto";
import type { TaskEvent, TaskRecord } from "./types.js";

type Listener = (event: TaskEvent) => void;

const tasks = new Map<string, TaskRecord>();
const events = new Map<string, TaskEvent[]>();
const listeners = new Map<string, Set<Listener>>();

export function createTask(prompt: string): TaskRecord {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: randomUUID(),
    prompt,
    status: "running",
    createdAt: now,
    updatedAt: now,
    pendingProposal: null,
    undoStack: [],
    lastError: null,
    iteration: 0,
  };
  tasks.set(task.id, task);
  events.set(task.id, []);
  listeners.set(task.id, new Set());
  emit(task.id, "status", "Task created", { status: task.status });
  return task;
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
