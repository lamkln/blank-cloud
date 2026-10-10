import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../settings/store.js";
import { getWorkspaceRoot } from "../config.js";
import { emit } from "./store.js";

export function templateRoot(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getDataDir(), "templates", safe);
}

export function copyWorkspaceTemplate(taskId: string, name: string): { copied: number } {
  const src = templateRoot(name);
  if (!fs.existsSync(src)) {
    throw new Error(`Template "${name}" not found at ${src}`);
  }
  const dest = getWorkspaceRoot();
  let copied = 0;

  function walk(rel: string): void {
    const abs = path.join(src, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const from = path.join(src, childRel);
      const to = path.join(dest, childRel);
      if (ent.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(childRel);
      } else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        copied += 1;
      }
    }
  }

  walk("");
  emit(taskId, "log", `Copied template "${name}" (${copied} files)`, { template: name, copied });
  return { copied };
}
