import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../config.js";
import { loadAppSettings } from "../settings/store.js";
import { runShellCommand } from "./runner.js";
import { emit, getTask, updateTask } from "./store.js";

export function resolveVerifyCommand(): string {
  const settings = loadAppSettings();
  const explicit = settings.agent.verifyCommand.trim();
  if (explicit) return explicit;
  const root = getWorkspaceRoot();
  if (fs.existsSync(path.join(root, "gradlew"))) {
    return "./gradlew build --no-daemon -q";
  }
  if (fs.existsSync(path.join(root, "package.json"))) {
    return "npm test --if-present";
  }
  return "";
}

const MAX_OUTPUT = 12_000;

export async function runWorkspaceVerify(taskId: string): Promise<{
  ok: boolean;
  output: string;
  skipped: boolean;
}> {
  const cmd = resolveVerifyCommand();
  if (!cmd) {
    return { ok: true, output: "", skipped: true };
  }
  const task = getTask(taskId);
  if (!task) {
    return { ok: false, output: "Task not found", skipped: false };
  }
  emit(taskId, "verify", `Running verify: ${cmd}`, { command: cmd, phase: "start" });
  const result = await runShellCommand(
    taskId,
    cmd,
    loadAppSettings().agent.verifyTimeoutSec * 1000,
  );
  const chunks = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const output =
    chunks.length > MAX_OUTPUT ? `${chunks.slice(0, MAX_OUTPUT)}\n…(truncated)` : chunks;
  const ok = result.exitCode === 0 && !result.timedOut;
  emit(taskId, "verify", ok ? "Verify passed" : "Verify failed", {
    ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output,
  });
  updateTask(taskId, {
    controls: {
      ...task.controls,
      verifyAttempts: task.controls.verifyAttempts + 1,
    },
  });
  return { ok, output, skipped: false };
}
