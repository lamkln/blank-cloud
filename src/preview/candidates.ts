import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace/paths.js";

const CANDIDATE_PATHS = [
  "index.html",
  "public/index.html",
  "dist/index.html",
  "build/index.html",
  "docs/index.html",
  "static/index.html",
  "site/index.html",
];

export function listPreviewCandidates(workspaceRoot: string): {
  defaultPath: string | null;
  candidates: string[];
} {
  const candidates: string[] = [];
  for (const rel of CANDIDATE_PATHS) {
    try {
      const abs = resolveWorkspacePath(rel, workspaceRoot);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        candidates.push(rel.replace(/\\/g, "/"));
      }
    } catch {
      /* skip */
    }
  }
  const defaultPath = candidates[0] ?? null;
  return { defaultPath, candidates };
}

export function injectHtmlBaseHref(html: string, previewBaseUrl: string): string {
  const baseTag = `<base href="${previewBaseUrl}">`;
  if (/<base\s/i.test(html)) {
    return html;
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
}

export function previewFileBaseUrl(relativePath: string): string {
  const dir = path.posix.dirname(relativePath.replace(/\\/g, "/"));
  const prefix = dir === "." ? "" : `${dir}/`;
  return `/preview/file/${prefix}`;
}
