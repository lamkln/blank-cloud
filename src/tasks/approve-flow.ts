import { getWorkspaceRoot } from "../config.js";
import { commitAndPush } from "../repo/git.js";
import { activeRepoSettings, usesActiveRemoteRepo } from "../repo/runtime.js";
import { loadAppSettings } from "../settings/store.js";
import {
  buildFailureContinuationUserMessage,
  runAgentTurnInternal,
} from "./agent.js";
import { canAutoApproveProposal, explainAutoApproveDenial } from "./auto-approve.js";
import { continueTaskOrchestrator } from "./orchestrator.js";
import { applyProposal } from "./proposals.js";
import { runShellCommands } from "./runner.js";
import { runWorkspaceVerify } from "./verify.js";
import { appendTaskMessage, emit, getTask, updateTask } from "./store.js";

export interface ApproveResult {
  status: string;
  applied: boolean;
  auto: boolean;
  verifyOk?: boolean;
}

async function maybePushAfterApply(taskId: string, summary: string, paths: string[]): Promise<void> {
  const repoSettings = activeRepoSettings();
  if (!repoSettings.pushOnApprove || !usesActiveRemoteRepo()) return;
  try {
    const pushResult = await commitAndPush(
      getWorkspaceRoot(),
      repoSettings,
      `blank-cloud: ${summary}`.slice(0, 200),
      paths,
    );
    if (pushResult.pushed) {
      emit(taskId, "log", `Pushed commit ${pushResult.commit} to origin`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit(taskId, "log", `Git push skipped: ${msg}`);
  }
}

export async function approveTaskProposal(
  taskId: string,
  source: "user" | "auto",
): Promise<ApproveResult> {
  const task = getTask(taskId);
  if (!task?.pendingProposal) {
    throw new Error("No pending proposal to approve");
  }
  const proposal = { ...task.pendingProposal };
  applyProposal(taskId);
  emit(
    taskId,
    "log",
    source === "auto" ? "Auto-approved proposal" : "Changes approved — applying to workspace",
    { source },
  );

  const commands = proposal.commands;
  if (commands.length > 0) {
    const results = await runShellCommands(taskId, commands);
    const failed = results.find((r) => r.exitCode !== 0 || r.timedOut);
    if (failed) {
      const err = failed.timedOut
        ? `Command timed out: ${failed.command}`
        : `Command failed (${failed.exitCode}): ${failed.command}`;
      updateTask(taskId, { status: "running", lastError: err });
      emit(taskId, "error", err);
      appendTaskMessage(
        taskId,
        "user",
        buildFailureContinuationUserMessage(getTask(taskId)!, err),
      );
      queueMicrotask(() => void runAgentTurnInternal(taskId));
      return { status: "running", applied: true, auto: source === "auto" };
    }
  }

  await maybePushAfterApply(taskId, proposal.summary, proposal.files.map((f) => f.path));

  const verify = await runWorkspaceVerify(taskId);
  const settings = loadAppSettings();
  if (!verify.skipped && !verify.ok) {
    const attempts = getTask(taskId)?.controls.verifyAttempts ?? 1;
    if (attempts <= settings.agent.verifyMaxRetries) {
      const msg = `Verify failed (attempt ${attempts}/${settings.agent.verifyMaxRetries}):\n${verify.output}`;
      updateTask(taskId, { status: "running", lastError: msg });
      emit(taskId, "error", msg);
      appendTaskMessage(taskId, "user", `${msg}\n\nFix the build/test errors and propose_changes.`);
      queueMicrotask(() => void runAgentTurnInternal(taskId));
      return { status: "running", applied: true, auto: source === "auto", verifyOk: false };
    }
    emit(taskId, "log", "Verify failed — max retries reached");
  }

  updateTask(taskId, { status: "running" });
  queueMicrotask(() => void continueTaskOrchestrator(taskId));
  return {
    status: "running",
    applied: true,
    auto: source === "auto",
    verifyOk: verify.ok,
  };
}

export async function tryAutoApprove(taskId: string): Promise<boolean> {
  const task = getTask(taskId);
  if (!task?.pendingProposal) return false;
  const denial = explainAutoApproveDenial(task, task.pendingProposal);
  if (denial) {
    updateTask(taskId, {
      controls: { ...task.controls, lastAutoApproveReason: denial },
    });
    emit(taskId, "log", denial, { autoApprove: false });
    return false;
  }
  if (!canAutoApproveProposal(task, task.pendingProposal)) return false;
  emit(taskId, "log", "Auto-approving proposal", { autoApprove: true });
  updateTask(taskId, {
    controls: { ...task.controls, lastAutoApproveReason: "Auto-approved" },
  });
  await approveTaskProposal(taskId, "auto");
  return true;
}
