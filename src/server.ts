import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureWorkspace, getPort, getRuntimeSettings, getWorkspaceRoot } from "./config.js";
import { ensureDataDir, isProviderConfigured, loadAppSettings } from "./settings/store.js";
import { attachUserContext, requireGitHubSignIn } from "./auth/middleware.js";
import { ensureGitHubOAuthClientIdFile } from "./auth/github-client-id.js";
import { authRoutes } from "./routes/auth.js";
import { settingsRoutes } from "./routes/settings.js";
import { repoRoutes } from "./routes/repo.js";
import { taskRoutes } from "./routes/tasks.js";
import { updateRoutes } from "./routes/update.js";
import { previewRoutes } from "./routes/preview.js";
import { BUILD_INFO } from "./build-info.generated.js";
import { startAutoUpdateScheduler } from "./update/service.js";

ensureWorkspace();
ensureDataDir();
ensureGitHubOAuthClientIdFile();
loadAppSettings();
startAutoUpdateScheduler();

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

app.get("/health", (c) => {
  const settings = loadAppSettings();
  const runtime = getRuntimeSettings();
  return c.json({
    ok: true,
    version: appVersion.version ?? "0.0.0",
    commit: BUILD_INFO.commit,
    ui: "0.3.7",
    workspace: getWorkspaceRoot(),
    llm: {
      provider: runtime.provider,
      model: runtime.model,
      configured: isProviderConfigured(runtime.provider, settings),
      customBaseUrl: runtime.customBaseUrl || null,
    },
  });
});

app.route("/auth", authRoutes);
app.route("/settings", settingsRoutes);
app.route("/update", updateRoutes);
app.use("/repo", requireGitHubSignIn);
app.use("/repo/*", requireGitHubSignIn);
app.route("/repo", repoRoutes);
app.use("/tasks", requireGitHubSignIn);
app.use("/tasks/*", requireGitHubSignIn);
app.route("/tasks", taskRoutes);
app.use("/preview", requireGitHubSignIn);
app.use("/preview/*", requireGitHubSignIn);
app.route("/preview", previewRoutes);

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
      update: "/update",
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
