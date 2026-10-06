import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureWorkspace, getPort, getWorkspaceRoot } from "./config.js";
import { ensureDataDir, loadAppSettings } from "./settings/store.js";
import { attachUserContext, requireGitHubSignIn } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { settingsRoutes } from "./routes/settings.js";
import { repoRoutes } from "./routes/repo.js";
import { taskRoutes } from "./routes/tasks.js";

ensureWorkspace();
ensureDataDir();
loadAppSettings();

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");
const appVersion = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
) as { version?: string };

const app = new Hono();

app.use("*", logger());
app.use("*", cors());
app.use("*", attachUserContext);

app.use("*", async (c, next) => {
  await next();
  const p = new URL(c.req.url).pathname;
  if (p === "/" || p.startsWith("/ui/")) {
    c.header("Cache-Control", "no-cache, must-revalidate");
  }
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    version: appVersion.version ?? "0.0.0",
    ui: "minimal-connect-github",
    workspace: getWorkspaceRoot(),
  }),
);

app.route("/auth", authRoutes);
app.route("/settings", settingsRoutes);
app.use("/repo", requireGitHubSignIn);
app.use("/repo/*", requireGitHubSignIn);
app.route("/repo", repoRoutes);
app.use("/tasks", requireGitHubSignIn);
app.use("/tasks/*", requireGitHubSignIn);
app.route("/tasks", taskRoutes);

app.get("/", serveStatic({ root: publicRoot, path: "index.html" }));
app.get(
  "/ui/*",
  serveStatic({
    root: publicRoot,
    rewriteRequestPath: (p) => p.replace(/^\/ui\/?/, ""),
  }),
);

app.get("/api", (c) =>
  c.json({
    name: "blank-cloud",
    workspace: getWorkspaceRoot(),
    ui: "/",
    endpoints: {
      health: "/health",
      settings: "/settings",
      repo: "/repo",
      tasks: "/tasks",
    },
  }),
);

serve(
  {
    fetch: app.fetch,
    port: getPort(),
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(
      `blank-cloud listening on http://${info.address}:${info.port} (workspace: ${getWorkspaceRoot()})`,
    );
  },
);
