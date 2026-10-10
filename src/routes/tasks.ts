import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getWorkspaceRoot } from "../config.js";
import { isWorkspaceReady } from "../repo/git.js";
import { buildRejectionUserMessage, runAgentTurn } from "../tasks/agent.js";
import { approveTaskProposal } from "../tasks/approve-flow.js";
import { requestTaskCancel } from "../tasks/cancel.js";
import { undoLastApply } from "../tasks/proposals.js";
import { taskToJson } from "../tasks/serialize.js";
import {
  appendTaskMessage,
  createTask,
  emit,
  getTask,
  listTaskEvents,
  listTasks,
  subscribe,
  updateTask,
} from "../tasks/store.js";
import { getRequestUser } from "../context/request.js";
import { usesActiveRemoteRepo } from "../repo/runtime.js";
import { isGitHubOAuthConfigured } from "../auth/github-oauth.js";

const tasks = new Hono();

function currentOwner(): string | null {
  return getRequestUser()?.login ?? null;
}

function canAccessTask(
  task: ReturnType<typeof getTask>,
): task is NonNullable<ReturnType<typeof getTask>> {
  if (!task) return false;
  const owner = currentOwner();
  if (owner && task.ownerLogin && task.ownerLogin !== owner) return false;
  return true;
}

tasks.get("/", (c) => {
  const items = listTasks(40, currentOwner()).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    updatedAt: t.updatedAt,
    createdAt: t.createdAt,
  }));
  return c.json({ tasks: items });
});

tasks.post("/", async (c) => {
  let body: {
    prompt?: string;
    message?: string;
    autoApprove?: boolean;
    referenceFiles?: string[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = (body.prompt ?? body.message ?? "").trim();
  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const root = getWorkspaceRoot();
  if (!isWorkspaceReady(root, usesActiveRemoteRepo())) {
    return c.json(
      {
        error: usesActiveRemoteRepo()
          ? "Select a GitHub repository first (sidebar)."
          : "Workspace is not ready. Sign in and select a repo, or configure a mount.",
        signInUrl: isGitHubOAuthConfigured() ? "/auth/github/login" : undefined,
      },
      400,
    );
  }

  const task = createTask(prompt, currentOwner(), {
    autoApprove: body.autoApprove,
    referenceFiles: body.referenceFiles,
  });
  queueMicrotask(() => {
    void runAgentTurn(task.id);
  });

  return c.json(
    {
      id: task.id,
      status: task.status,
      stream: `/tasks/${task.id}/stream`,
    },
    201,
  );
});

tasks.get("/:id/events", (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  return c.json({ events: listTaskEvents(task.id) });
});

tasks.get("/:id", (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  return c.json(taskToJson(task));
});

tasks.post("/:id/message", async (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status === "running" || task.status === "executing") {
    return c.json({ error: "Agent is still working on this run" }, 409);
  }
  if (task.pendingProposal) {
    return c.json({ error: "Approve or reject the pending changes first" }, 409);
  }

  let body: { message?: string; prompt?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const message = (body.message ?? body.prompt ?? "").trim();
  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  appendTaskMessage(task.id, "user", message);
  queueMicrotask(() => {
    void runAgentTurn(task.id);
  });

  return c.json({ id: task.id, status: "running" });
});

tasks.post("/:id/reject", async (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (!task.pendingProposal) {
    return c.json({ error: "No pending proposal to reject" }, 400);
  }

  let feedback = "";
  try {
    const body = await c.req.json();
    feedback = (body?.feedback ?? body?.message ?? "").trim();
  } catch {
    /* empty body ok */
  }

  updateTask(task.id, { pendingProposal: null, status: "running" });
  emit(task.id, "rejected", feedback || "Changes rejected", { feedback });

  appendTaskMessage(task.id, "user", buildRejectionUserMessage(feedback));
  queueMicrotask(() => {
    void runAgentTurn(task.id);
  });

  return c.json({ id: task.id, status: "running" });
});

tasks.post("/:id/approve", async (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (!task.pendingProposal) {
    return c.json({ error: "No pending proposal to approve" }, 400);
  }
  try {
    const result = await approveTaskProposal(task.id, "user");
    return c.json({ id: task.id, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }
});

tasks.post("/:id/cancel", (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  requestTaskCancel(task.id);
  updateTask(task.id, {
    status: "cancelled",
    controls: { ...task.controls, cancelRequested: true },
  });
  emit(task.id, "status", "Cancel requested", { status: "cancelled" });
  return c.json({ id: task.id, status: "cancelled" });
});

tasks.post("/:id/retry", (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (task.status === "running" || task.status === "executing") {
    return c.json({ error: "Task is still running" }, 409);
  }
  updateTask(task.id, { status: "running", lastError: null });
  queueMicrotask(() => {
    void runAgentTurn(task.id);
  });
  return c.json({ id: task.id, status: "running" });
});

tasks.post("/:id/undo", (c) => {
  const task = getTask(c.req.param("id"));
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }
  const undone = undoLastApply(task.id);
  if (!undone) {
    return c.json({ error: "Nothing to undo" }, 400);
  }
  return c.json({
    id: task.id,
    undone: true,
    files: undone.files.map((f) => f.path),
  });
});

tasks.get("/:id/stream", (c) => {
  const taskId = c.req.param("id");
  const task = getTask(taskId);
  if (!canAccessTask(task)) {
    return c.json({ error: "Task not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    for (const event of listTaskEvents(taskId)) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    }

    const unsub = subscribe(taskId, async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    });

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const current = getTask(taskId);
        if (
          !current ||
          current.status === "completed" ||
          current.status === "failed" ||
          current.status === "cancelled"
        ) {
          clearInterval(interval);
          unsub();
          resolve();
        }
      }, 500);
    });

    await stream.writeSSE({
      event: "stream_end",
      data: JSON.stringify({ taskId, reason: "terminal_status" }),
    });
  });
});

export { tasks as taskRoutes };
