import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureWorkspace, getPort, getWorkspaceRoot } from "./config.js";
import { settingsRoutes } from "./routes/settings.js";
import { taskRoutes } from "./routes/tasks.js";

ensureWorkspace();

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ ok: true, workspace: getWorkspaceRoot() }),
);

app.route("/settings", settingsRoutes);
app.route("/tasks", taskRoutes);

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
