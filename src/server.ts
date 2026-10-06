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

app.get("/", (c) => {
  const base = new URL(c.req.url).origin;
  const info = {
    name: "blank-cloud",
    workspace: getWorkspaceRoot(),
    docs: "https://github.com/lamkln/blank-cloud",
    endpoints: {
      health: `${base}/health`,
      settings: `${base}/settings`,
      createTask: `POST ${base}/tasks`,
      taskStream: `GET ${base}/tasks/:id/stream`,
    },
  };
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("text/html")) {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>blank-cloud</title></head>
<body>
  <h1>blank-cloud</h1>
  <p>Self-hosted coding agent API (workspace: <code>${info.workspace}</code>)</p>
  <ul>
    <li><a href="${info.endpoints.health}">/health</a></li>
    <li><a href="${info.endpoints.settings}">/settings</a></li>
  </ul>
  <p>Create work via <code>POST /tasks</code> with JSON <code>{"prompt":"..."}</code>.</p>
  <p><a href="${info.docs}">GitHub</a></p>
</body>
</html>`);
  }
  return c.json(info);
});

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
