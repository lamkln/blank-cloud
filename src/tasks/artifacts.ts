import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveWorkspacePath } from "../workspace/paths.js";

export interface TaskArtifact {
  id: string;
  name: string;
  /** Path relative to workspace root */
  path: string;
  sha256: string;
  size: number;
  kind: "jar" | "zip" | "other";
  createdAt: string;
}

const artifactsByTask = new Map<string, TaskArtifact[]>();

function sha256File(abs: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(abs));
  return hash.digest("hex");
}

export function registerArtifact(
  taskId: string,
  relativePath: string,
  name?: string,
): TaskArtifact {
  const abs = resolveWorkspacePath(relativePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`Artifact file not found: ${relativePath}`);
  }
  const stat = fs.statSync(abs);
  const base = name ?? path.basename(relativePath);
  const ext = path.extname(base).toLowerCase();
  const kind: TaskArtifact["kind"] =
    ext === ".jar" ? "jar" : ext === ".zip" ? "zip" : "other";
  const entry: TaskArtifact = {
    id: `${taskId}-${artifactsByTask.get(taskId)?.length ?? 0}`,
    name: base,
    path: relativePath.replace(/\\/g, "/"),
    sha256: sha256File(abs),
    size: stat.size,
    kind,
    createdAt: new Date().toISOString(),
  };
  const list = artifactsByTask.get(taskId) ?? [];
  const existing = list.findIndex((a) => a.path === entry.path);
  if (existing >= 0) {
    list[existing] = entry;
  } else {
    list.push(entry);
  }
  artifactsByTask.set(taskId, list);
  return entry;
}

export function listArtifacts(taskId: string): TaskArtifact[] {
  return artifactsByTask.get(taskId) ?? [];
}

export function getArtifact(taskId: string, artifactId: string): TaskArtifact | undefined {
  return listArtifacts(taskId).find((a) => a.id === artifactId || a.name === artifactId);
}
