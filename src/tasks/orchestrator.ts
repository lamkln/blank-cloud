import { loadAppSettings } from "../settings/store.js";
import { assertNotCancelled, clearTaskRun } from "./cancel.js";
import { generateTaskPlan, shouldCreatePlan } from "./planning.js";
import { copyWorkspaceTemplate } from "./template.js";
import { tryAutoApprove } from "./approve-flow.js";
import { runAgentTurnInternal } from "./agent.js";
import { appendTaskMessage, emit, getTask, updateTask } from "./store.js";
import type { TaskPlanStep } from "./types.js";

function emitPlan(taskId: string): void {
  const task = getTask(taskId);
  if (!task?.plan) return;
  emit(taskId, "plan", "Task plan updated", {
    plan: task.plan,
    steps: task.plan.steps,
    currentStepIndex: task.plan.currentStepIndex,
  });
}

function markStep(taskId: string, index: number, status: TaskPlanStep["status"], summary?: string): void {
  const task = getTask(taskId);
  if (!task?.plan) return;
  const now = new Date().toISOString();
  const steps = task.plan.steps.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, status, summary: summary ?? s.summary };
    if (status === "running" && !next.startedAt) next.startedAt = now;
    if (status === "done" && next.startedAt) {
      next.completedAt = now;
      next.durationMs = Date.parse(now) - Date.parse(next.startedAt);
    }
    return next;
  });
  updateTask(taskId, { plan: { ...task.plan, steps } });
  emitPlan(taskId);
}

export async function runTaskOrchestrator(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  const settings = loadAppSettings();

  try {
    assertNotCancelled(taskId);

    if (task.options.template?.trim()) {
      try {
        copyWorkspaceTemplate(taskId, task.options.template.trim());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit(taskId, "log", `Template skipped: ${msg}`);
      }
    }

    if (!task.plan && shouldCreatePlan(task.prompt, settings.agent)) {
      emit(taskId, "status", "Planning…", { phase: "planning" });
      const plan = await generateTaskPlan(taskId, task.prompt);
      updateTask(taskId, { plan, status: "running" });
      emitPlan(taskId);
      appendTaskMessage(
        taskId,
        "assistant",
        `Plan (${plan.steps.length} steps):\n${plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`,
      );
    }

    const refreshed = getTask(taskId);
    if (!refreshed) return;

    if (refreshed.plan) {
      await runNextPlanStep(taskId);
      return;
    }

    await runAgentTurnInternal(taskId);
    const after = getTask(taskId);
    if (after?.pendingProposal) {
      await tryAutoApprove(taskId);
    }
  } finally {
    clearTaskRun(taskId);
  }
}

async function runNextPlanStep(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task?.plan) {
    await runAgentTurnInternal(taskId);
    return;
  }

  let idx = task.plan.currentStepIndex;
  while (idx < task.plan.steps.length) {
    assertNotCancelled(taskId);
    const step = task.plan.steps[idx];
    if (step.status === "done" || step.status === "skipped") {
      idx += 1;
      continue;
    }

    updateTask(taskId, {
      plan: { ...task.plan, currentStepIndex: idx },
      status: "running",
    });
    markStep(taskId, idx, "running");

    const settings = loadAppSettings();
    const stepPrompt = [
      `Plan step ${idx + 1}/${task.plan.steps.length}: ${step.title}`,
      step.filesHint ? `Target files: ${step.filesHint}` : "",
      `Project summary: ${task.plan.compactSummary}`,
      `Use propose_changes for at most ${settings.agent.maxFilesPerStep} files in this step.`,
    ]
      .filter(Boolean)
      .join("\n");

    const marker = `[plan-step:${step.id}]`;
    const already = task.messages.some((m) => m.role === "user" && m.content.includes(marker));
    if (!already) {
      appendTaskMessage(taskId, "user", `${marker}\n${stepPrompt}`);
    }

    await runAgentTurnInternal(taskId, { modelRole: "edit", deferCompletion: true });

    const mid = getTask(taskId);
    if (!mid) return;
    if (mid.pendingProposal) {
      const auto = await tryAutoApprove(taskId);
      if (!auto) {
        updateTask(taskId, { status: "awaiting_approval" });
        return;
      }
      const afterApprove = getTask(taskId);
      if (afterApprove?.pendingProposal) return;
    } else {
      markStep(taskId, idx, "done");
      idx += 1;
      updateTask(taskId, {
        plan: { ...getTask(taskId)!.plan!, currentStepIndex: idx },
      });
      continue;
    }

    markStep(taskId, idx, "done");
    idx += 1;
    updateTask(taskId, {
      plan: { ...getTask(taskId)!.plan!, currentStepIndex: idx },
    });
  }

  updateTask(taskId, { status: "completed" });
  emit(taskId, "done", "All plan steps finished", { status: "completed" });
}

export async function continueTaskOrchestrator(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  if (task.plan) {
    const idx = task.plan.currentStepIndex;
    markStep(taskId, idx, "done");
    const next = idx + 1;
    updateTask(taskId, {
      plan: { ...task.plan, currentStepIndex: next },
      status: "running",
    });
    await runTaskOrchestrator(taskId);
    return;
  }
  updateTask(taskId, { status: "completed" });
  emit(taskId, "done", "Changes applied", { status: "completed" });
}
