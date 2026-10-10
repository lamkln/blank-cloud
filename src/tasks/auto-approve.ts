import { loadAppSettings } from "../settings/store.js";
import type { AutoApproveSettings } from "../settings/agent-settings.js";
import { snapshotFile } from "../workspace/paths.js";
import type { PendingProposal, TaskRecord } from "./types.js";

export function resolveAutoApproveSettings(task: TaskRecord): AutoApproveSettings {
  const global = loadAppSettings().agent.autoApprove;
  if (task.options.autoApprove === true) {
    return { ...global, enabled: true };
  }
  if (task.options.autoApprove === false) {
    return { ...global, enabled: false };
  }
  return global;
}

export function canAutoApproveProposal(
  task: TaskRecord,
  proposal: PendingProposal,
): boolean {
  const rules = resolveAutoApproveSettings(task);
  if (!rules.enabled) return false;
  if (proposal.commands.length > 0 && !rules.allowShellCommands) {
    return false;
  }
  const prefix = rules.pathPrefix.trim().replace(/\\/g, "/");
  for (const file of proposal.files) {
    const path = file.path.replace(/\\/g, "/");
    if (prefix && !path.startsWith(prefix.replace(/\/$/, ""))) {
      return false;
    }
    if (rules.newFilesOnly) {
      const snap = snapshotFile(file.path);
      if (snap.existed) return false;
    }
  }
  return true;
}
