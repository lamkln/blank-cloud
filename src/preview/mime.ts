import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const BLOCKED = new Set([
  ".env",
  ".pem",
  ".key",
  ".p12",
  ".sqlite",
  ".db",
  ".sh",
  ".bash",
]);

export function previewContentType(filePath: string): string | null {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  if (!ext || BLOCKED.has(ext) || base === ".env") {
    return null;
  }
  return MIME[ext] ?? null;
}

export function isPreviewHtmlType(contentType: string): boolean {
  return contentType.startsWith("text/html");
}
