const cancelRequested = new Set<string>();
const abortControllers = new Map<string, AbortController>();

export function beginTaskRun(taskId: string): AbortSignal {
  cancelRequested.delete(taskId);
  const existing = abortControllers.get(taskId);
  if (existing) {
    existing.abort();
  }
  const ac = new AbortController();
  abortControllers.set(taskId, ac);
  return ac.signal;
}

export function requestTaskCancel(taskId: string): void {
  cancelRequested.add(taskId);
  abortControllers.get(taskId)?.abort();
}

export function clearTaskRun(taskId: string): void {
  cancelRequested.delete(taskId);
  abortControllers.delete(taskId);
}

export function isTaskCancelRequested(taskId: string): boolean {
  return cancelRequested.has(taskId);
}

export function getTaskAbortSignal(taskId: string): AbortSignal | undefined {
  return abortControllers.get(taskId)?.signal;
}

export function assertNotCancelled(taskId: string): void {
  if (isTaskCancelRequested(taskId)) {
    throw new Error("Task cancelled");
  }
}
