import type { LanguageModel } from "ai";
import { loadAppSettings } from "../settings/store.js";
import { logAgentTask } from "../tasks/agent-log.js";
import { createLanguageModelForProfile } from "./model-runtime.js";
import type { ModelProfile } from "../settings/agent-settings.js";
import type { ModelRole } from "./model-runtime.js";

function isRetryableModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("no model response within")) return true;
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  if (msg.includes("410") || msg.includes("gone")) return true;
  if (msg.includes("404") && msg.includes("model")) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  return false;
}

export function profilesForRole(role: ModelRole): ModelProfile[] {
  const settings = loadAppSettings();
  const primary: ModelProfile =
    role === "planning" && settings.agent.planningModel
      ? settings.agent.planningModel
      : role === "edit" && settings.agent.editModel
        ? settings.agent.editModel
        : {
            provider: settings.provider,
            model: settings.model,
            customBaseUrl: settings.customBaseUrl,
          };

  const list: ModelProfile[] = [primary];
  for (const fb of settings.agent.modelFallbacks) {
    list.push(fb);
  }
  return list;
}

export async function runWithModelFallback<T>(
  taskId: string,
  role: ModelRole | "default",
  fn: (model: LanguageModel, label: string) => Promise<T>,
): Promise<T> {
  const profiles = profilesForRole(role === "default" ? "edit" : role);
  let lastErr: unknown;
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const label = `${profile.provider}/${profile.model}`;
    try {
      const model = createLanguageModelForProfile(profile);
      logAgentTask(taskId, `Using model profile ${i + 1}/${profiles.length}: ${label}`);
      return await fn(model, label);
    } catch (err) {
      lastErr = err;
      const retry = isRetryableModelError(err);
      logAgentTask(taskId, `Model profile failed: ${label}`, {
        error: err instanceof Error ? err.message : String(err),
        retry,
      });
      if (!retry || i === profiles.length - 1) {
        throw err;
      }
      logAgentTask(taskId, `Falling back to next model profile`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
