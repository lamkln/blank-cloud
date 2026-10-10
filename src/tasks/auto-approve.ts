import { loadAppSettings } from "../settings/store.js";
import type { AutoApproveSettings } from "../settings/agent-settings.js";
import { snapshotFile } from "../workspace/paths.js";
import type { PendingProposal, TaskRecord } from "./types.js";

export function resolveAutoApproveSettings(task: TaskRecord): AutoApproveSettings {
  const global = loadAppSettings().agent.autoApprove;
  if (task.options.autoApprove === false) {
    return { ...global, enabled: false };
  }
  if (task.options.autoApprove === true) {
    const base = { ...global, enabled: true };
    if (task.options.autoApproveRelaxRules) {
      return {
        ...base,
        newFilesOnly: false,
        pathPrefix: "",
        allowShellCommands: task.options.autoApproveAllowShell ?? base.allowShellCommands,
      };
    }
    return base;
  }
  return global;
}

export function explainAutoApproveDenial(
  task: TaskRecord,
  proposal: PendingProposal,
): string | null {
  const rules = resolveAutoApproveSettings(task);
  if (!rules.enabled) {
    if (task.options.autoApprove !== true && !loadAppSettings().agent.autoApprove.enabled) {
      return "Auto-approve is off (enable in Settings or pass autoApprove: true on POST /tasks)";
    }
    return "Auto-approve is off for this task";
  }
  if (proposal.commands.length > 0 && !rules.allowShellCommands) {
    return "Not auto-approved: proposal includes shell commands (enable allowShellCommands or autoApproveAllowShell)";
  }
  const prefix = rules.pathPrefix.trim().replace(/\\/g, "/");
  for (const file of proposal.files) {
    const path = file.path.replace(/\\/g, "/");
    if (prefix && !path.startsWith(prefix.replace(/\/$/, ""))) {
      return `Not auto-approved: path "${path}" is outside prefix "${prefix}" (pass autoApproveRelaxRules: true to ignore)`;
    }
    if (rules.newFilesOnly) {
      const snap = snapshotFile(file.path);
      if (snap.existed) {
        return `Not auto-approved: "${path}" already exists (newFilesOnly is on; pass autoApproveRelaxRules: true to ignore)`;
      }
    }
  }
  return null;
}

export function canAutoApproveProposal(
  task: TaskRecord,
  proposal: PendingProposal,
): boolean {
  return explainAutoApproveDenial(task, proposal) === null;
}
