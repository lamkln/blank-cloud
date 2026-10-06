import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureWorkspace, getPort, getWorkspaceRoot } from "./config.js";
import { ensureDataDir, loadAppSettings } from "./settings/store.js";
import { settingsRoutes } from "./routes/settings.js";
import { taskRoutes } from "./routes/tasks.js";

ensureWorkspace();
ensureDataDir();
loadAppSettings();

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ ok: true, workspace: getWorkspaceRoot() }),
);

app.route("/settings", settingsRoutes);
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
