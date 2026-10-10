import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../config.js";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

/** Resolve a user-supplied path to an absolute path inside the workspace. */
export function resolveWorkspacePath(
  relativeOrAbsolute: string,
  workspaceRoot?: string,
): string {
  const root = workspaceRoot ?? getWorkspaceRoot();
  const normalized = relativeOrAbsolute.replace(/^\/+/, "");
  const candidate = path.resolve(root, normalized);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WorkspacePathError(`Path escapes workspace: ${relativeOrAbsolute}`);
  }
  return candidate;
}

export function listDirectory(relativePath: string): string[] {
  const abs = resolveWorkspacePath(relativePath || ".");
  if (!fs.existsSync(abs)) {
    throw new WorkspacePathError(`Not found: ${relativePath || "."}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    throw new WorkspacePathError(`Not a directory: ${relativePath}`);
  }
  return fs.readdirSync(abs).sort();
}

export function readWorkspaceFile(relativePath: string, maxBytes = 512_000): string {
  const abs = resolveWorkspacePath(relativePath);
  if (!fs.existsSync(abs)) {
    throw new WorkspacePathError(`File not found: ${relativePath}`);
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    throw new WorkspacePathError(`Not a file: ${relativePath}`);
  }
  if (stat.size > maxBytes) {
    throw new WorkspacePathError(
      `File too large (${stat.size} bytes). Max ${maxBytes} bytes.`,
    );
  }
  return fs.readFileSync(abs, "utf8");
}

export function writeWorkspaceFile(relativePath: string, content: string): void {
  const abs = resolveWorkspacePath(relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

export function snapshotFile(relativePath: string): { path: string; existed: boolean; content: string | null } {
  const abs = resolveWorkspacePath(relativePath);
  if (!fs.existsSync(abs)) {
    return { path: relativePath, existed: false, content: null };
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    return { path: relativePath, existed: false, content: null };
  }
  return {
    path: relativePath,
    existed: true,
    content: fs.readFileSync(abs, "utf8"),
  };
}

export function restoreSnapshot(entry: {
  path: string;
  existed: boolean;
  content: string | null;
}): void {
  const abs = resolveWorkspacePath(entry.path);
  if (!entry.existed) {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, entry.content ?? "", "utf8");
}
