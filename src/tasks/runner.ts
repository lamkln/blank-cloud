import { spawn } from "node:child_process";
import { getWorkspaceRoot } from "../config.js";
import { emit } from "./store.js";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CommandResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export async function runShellCommand(
  taskId: string,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  emit(taskId, "log", `$ ${command}`, { command });

  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd: getWorkspaceRoot(),
      env: process.env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n").filter(Boolean)) {
        emit(taskId, "command_stdout", line, { command });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n").filter(Boolean)) {
        emit(taskId, "command_stderr", line, { command });
      }
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const exitCode = code;
      emit(taskId, "command_exit", `exit ${exitCode ?? signal}`, {
        command,
        exitCode,
        signal,
        timedOut,
      });
      resolve({
        command,
        exitCode,
        signal,
        timedOut,
      });
    });
  });
}

export async function runShellCommands(
  taskId: string,
  commands: string[],
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const command of commands) {
    const result = await runShellCommand(taskId, command);
    results.push(result);
    if (result.exitCode !== 0 || result.timedOut) {
      break;
    }
  }
  return results;
}
