import { emit } from "./store.js";

export function logAgentTask(
  taskId: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const detail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[blank-cloud agent ${taskId}] ${message}${detail}`);
  emit(taskId, "log", message, extra);
}
