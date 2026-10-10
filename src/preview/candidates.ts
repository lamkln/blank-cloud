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

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  "coverage",
  ".cache",
  "vendor",
]);

/** Shallow scan for .html files so agent-created paths are discoverable. */
export function discoverHtmlFiles(workspaceRoot: string, maxDepth = 5): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!name.toLowerCase().endsWith(".html")) continue;
      const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
      if (!rel.startsWith("..")) found.push(rel);
    }
  };
  walk(workspaceRoot, 0);
  return found.sort((a, b) => a.localeCompare(b));
}

export function listPreviewCandidates(workspaceRoot: string): {
  defaultPath: string | null;
  candidates: string[];
} {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (rel: string) => {
    const n = rel.replace(/\\/g, "/");
    if (seen.has(n)) return;
    seen.add(n);
    candidates.push(n);
  };
  for (const rel of CANDIDATE_PATHS) {
    try {
      const abs = resolveWorkspacePath(rel, workspaceRoot);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        add(rel);
      }
    } catch {
      /* skip */
    }
  }
  for (const rel of discoverHtmlFiles(workspaceRoot)) {
    add(rel);
  }
  const defaultPath = candidates[0] ?? null;
  return { defaultPath, candidates };
}

export const STARTER_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="hero">
      <p class="eyebrow">Your site</p>
      <h1>Simple landing page</h1>
      <p class="lead">Edit <code>index.html</code> and <code>styles.css</code>, or ask the agent to redesign this page.</p>
      <a class="btn" href="#">Get started</a>
    </header>
  </body>
</html>
`;

export const STARTER_STYLES_CSS = `* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0f1419;
  color: #e8eaed;
}
.hero {
  max-width: 42rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
  text-align: center;
}
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; opacity: 0.7; }
h1 { font-size: clamp(2rem, 5vw, 2.75rem); margin: 0.5rem 0 1rem; }
.lead { line-height: 1.6; opacity: 0.9; }
.btn {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.65rem 1.25rem;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}
code { font-size: 0.9em; }
`;

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
