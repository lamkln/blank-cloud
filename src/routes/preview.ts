import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getWorkspaceRoot } from "../config.js";
import {
  injectHtmlBaseHref,
  listPreviewCandidates,
  previewFileBaseUrl,
} from "../preview/candidates.js";
import { isPreviewHtmlType, previewContentType } from "../preview/mime.js";
import { resolveWorkspacePath, WorkspacePathError } from "../workspace/paths.js";

const preview = new Hono();

preview.get("/meta", (c) => {
  const root = getWorkspaceRoot();
  const { defaultPath, candidates } = listPreviewCandidates();
  return c.json({
    workspace: root,
    defaultPath,
    candidates,
    previewUrl: defaultPath ? `/preview/file/${defaultPath}` : null,
  });
});

function relativePreviewPath(c: { req: { path: string } }): string {
  const p = c.req.path;
  const markers = ["/preview/file/", "/file/"];
  for (const marker of markers) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      return decodeURIComponent(p.slice(idx + marker.length)).replace(/^\/+/, "");
    }
  }
  return "index.html";
}

preview.get("/file/*", async (c) => {
  const relative = relativePreviewPath(c) || "index.html";

  let abs: string;
  try {
    abs = resolveWorkspacePath(relative);
  } catch (e) {
    const msg = e instanceof WorkspacePathError ? e.message : "Invalid path";
    return c.text(msg, 400);
  }

  if (!fs.existsSync(abs)) {
    return c.text("Not found", 404);
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const index = path.join(abs, "index.html");
    if (fs.existsSync(index) && fs.statSync(index).isFile()) {
      return c.redirect(`/preview/file/${relative.replace(/\/$/, "")}/index.html`);
    }
    return c.text("Directory listing not available", 404);
  }

  const contentType = previewContentType(abs);
  if (!contentType) {
    return c.text("File type not allowed for preview", 403);
  }

  if (stat.size > 15 * 1024 * 1024) {
    return c.text("File too large for preview", 413);
  }

  if (isPreviewHtmlType(contentType)) {
    const raw = fs.readFileSync(abs, "utf8");
    const baseUrl = previewFileBaseUrl(relative);
    const body = injectHtmlBaseHref(raw, baseUrl);
    return c.body(body, 200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; img-src * data: blob:; font-src * data:; connect-src *;",
    });
  }

  const data = fs.readFileSync(abs);
  return c.body(data, 200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
});

export { preview as previewRoutes };
