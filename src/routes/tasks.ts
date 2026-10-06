import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  buildFailureContinuationPrompt,
  runAgentTurn,
} from "../tasks/agent.js";
import { applyProposal, undoLastApply } from "../tasks/proposals.js";
import { runShellCommands } from "../tasks/runner.js";
import {
  createTask,
  emit,
  getTask,
  listTaskEvents,
  subscribe,
  updateTask,
} from "../tasks/store.js";

const tasks = new Hono();

tasks.post("/", async (c) => {
  let body: { prompt?: string; message?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = (body.prompt ?? body.message ?? "").trim();
  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const task = createTask(prompt);
  queueMicrotask(() => {
    void runAgentTurn(task.id, prompt);
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

tasks.get("/:id", (c) => {
  const task = getTask(c.req.param("id"));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  return c.json({
    id: task.id,
    status: task.status,
    prompt: task.prompt,
    pendingProposal: task.pendingProposal,
    lastError: task.lastError,
    iteration: task.iteration,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
});

tasks.post("/:id/approve", async (c) => {
  const task = getTask(c.req.param("id"));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (!task.pendingProposal) {
    return c.json({ error: "No pending proposal to approve" }, 400);
  }

  const proposal = { ...task.pendingProposal };
  try {
    applyProposal(task.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }

  emit(task.id, "log", "Proposal approved; applying changes");

  const commands = proposal.commands;
  if (commands.length === 0) {
    updateTask(task.id, { status: "completed" });
    emit(task.id, "done", "Changes applied (no commands)", { status: "completed" });
    return c.json({ id: task.id, status: "completed", applied: true, commandsRun: [] });
  }

  const results = await runShellCommands(task.id, commands);
  const failed = results.find((r) => r.exitCode !== 0 || r.timedOut);
  const refreshed = getTask(task.id)!;

  if (failed) {
    const err = failed.timedOut
      ? `Command timed out: ${failed.command}`
      : `Command failed (${failed.exitCode}): ${failed.command}`;
    updateTask(task.id, { status: "running", lastError: err });
    emit(task.id, "error", err);
    void runAgentTurn(
      task.id,
      buildFailureContinuationPrompt(refreshed, err),
    );
    return c.json({
      id: task.id,
      status: "running",
      applied: true,
      commandsRun: results,
      followUp: "Agent proposing fix after command failure",
    });
  }

  updateTask(task.id, { status: "completed" });
  emit(task.id, "done", "Changes applied and commands succeeded", { status: "completed" });

  return c.json({
    id: task.id,
    status: "completed",
    applied: true,
    commandsRun: results,
  });
});

tasks.post("/:id/undo", (c) => {
  const task = getTask(c.req.param("id"));
  if (!task) {
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
  if (!task) {
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
