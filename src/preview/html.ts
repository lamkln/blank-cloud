export function previewErrorPage(title: string, message: string): string {
  const safeTitle = title.replace(/</g, "&lt;");
  const safeMsg = message.replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #1a1a1a; color: #eee; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    p { max-width: 36rem; opacity: 0.9; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeMsg}</p>
</body>
</html>`;
}
