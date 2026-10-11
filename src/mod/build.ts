import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getWorkspaceRoot } from "../config.js";
import { resolveWorkspacePath } from "../workspace/paths.js";
import { runShellCommand } from "../tasks/runner.js";
import { parseGradleCompileErrors } from "./gradle-errors.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.BLANK_CLOUD_MOD_BUILD_TIMEOUT_MS) || 600_000;

const failOnceTasks = new Set<string>();

export function markModBuildFailOnce(taskId: string): void {
  failOnceTasks.add(taskId);
}

function sha256File(abs: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(abs));
  return hash.digest("hex");
}

function discoverJars(projectAbs: string, projectRel: string): string[] {
  const libs = path.join(projectAbs, "build", "libs");
  if (!fs.existsSync(libs)) return [];
  return fs
    .readdirSync(libs)
    .filter((f) => f.endsWith(".jar") && !f.endsWith("-sources.jar") && !f.endsWith("-dev.jar"))
    .map((f) => `${projectRel}/build/libs/${f}`);
}

export interface ModBuildResult {
  success: boolean;
  projectPath: string;
  exitCode: number | null;
  timedOut: boolean;
  compileErrors: { file: string; line: number; message: string }[];
  artifacts: { path: string; sha256: string; size: number }[];
  logTail: string;
}

export async function runModBuild(
  taskId: string,
  projectPath: string,
): Promise<ModBuildResult> {
  const projectRel = projectPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const projectAbs = resolveWorkspacePath(projectRel);
  const gradlew = path.join(projectAbs, "gradlew");
  if (!fs.existsSync(gradlew)) {
    return {
      success: false,
      projectPath: projectRel,
      exitCode: 1,
      timedOut: false,
      compileErrors: [],
      artifacts: [],
      logTail: "gradlew not found — run mod_scaffold first",
    };
  }

  if (failOnceTasks.has(taskId)) {
    failOnceTasks.delete(taskId);
    return {
      success: false,
      projectPath: projectRel,
      exitCode: 1,
      timedOut: false,
      compileErrors: [
        {
          file: `${projectRel}/src/main/java/com/example/inject/InjectedError.java`,
          line: 1,
          message: "injected test error: class InjectedError is public, should be declared in a file named InjectedError.java",
        },
      ],
      artifacts: [],
      logTail: `${projectRel}/src/main/java/com/example/inject/InjectedError.java:1: error: injected test compile failure`,
    };
  }

  const cmd = `cd "${projectRel}" && chmod +x ./gradlew && ./gradlew build --no-daemon --stacktrace`;
  const result = await runShellCommand(taskId, cmd, DEFAULT_TIMEOUT_MS);

  const combined = `${result.stdout}\n${result.stderr}`;
  const compileErrors = parseGradleCompileErrors(combined);
  const jarPaths = discoverJars(projectAbs, projectRel);
  const artifacts = jarPaths.map((rel) => {
    const abs = path.join(getWorkspaceRoot(), rel);
    const stat = fs.statSync(abs);
    return { path: rel, sha256: sha256File(abs), size: stat.size };
  });

  const success = result.exitCode === 0 && !result.timedOut && artifacts.length > 0;

  return {
    success,
    projectPath: projectRel,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    compileErrors,
    artifacts,
    logTail: combined.slice(-4000),
  };
}
