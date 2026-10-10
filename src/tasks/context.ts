import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../config.js";
import { loadAppSettings } from "../settings/store.js";
import { listDirectory, readWorkspaceFile } from "../workspace/paths.js";
import type { TaskRecord } from "./types.js";

const MAX_CONTEXT_CHARS = 48_000;

function readOptionalWorkspaceFile(rel: string): string | null {
  try {
    return readWorkspaceFile(rel);
  } catch {
    return null;
  }
}

export function buildWorkspaceContextBlock(task: TaskRecord): string {
  const settings = loadAppSettings();
  const parts: string[] = [];
  const paths = new Set<string>([
    ...settings.agent.instructionFiles,
    ...settings.agent.referenceFiles,
    ...(task.options.referenceFiles ?? []),
  ]);

  for (const rel of paths) {
    const p = rel.trim();
    if (!p) continue;
    const content = readOptionalWorkspaceFile(p);
    if (content) {
      parts.push(`--- ${p} ---\n${content}`);
    }
  }

  const root = getWorkspaceRoot();
  const agentsPath = path.join(root, "AGENTS.md");
  if (fs.existsSync(agentsPath) && !paths.has("AGENTS.md")) {
    parts.push(`--- AGENTS.md ---\n${fs.readFileSync(agentsPath, "utf8")}`);
  }

  let block = parts.join("\n\n");
  if (block.length > MAX_CONTEXT_CHARS) {
    block = `${block.slice(0, MAX_CONTEXT_CHARS)}\n…(truncated)`;
  }
  if (!block.trim()) return "";
  return `\n\nProject context (reference):\n${block}`;
}

export function shallowFileTree(): string {
  try {
    const top = listDirectory(".");
    return top.slice(0, 80).join("\n") || "(empty workspace)";
  } catch {
    return "(could not list workspace)";
  }
}
