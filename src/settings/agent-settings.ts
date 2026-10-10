import type { LlmProvider } from "./store.js";

export interface ModelProfile {
  provider: LlmProvider;
  model: string;
  customBaseUrl?: string;
}

export interface ModelFallbackEntry extends ModelProfile {
  id: string;
  label?: string;
}

export interface AutoApproveSettings {
  enabled: boolean;
  newFilesOnly: boolean;
  /** Only auto-approve paths under this prefix (empty = any). */
  pathPrefix: string;
  allowShellCommands: boolean;
}

export interface AgentSettings {
  firstResponseTimeoutSec: number;
  maxFilesPerStep: number;
  autoApprove: AutoApproveSettings;
  verifyCommand: string;
  verifyMaxRetries: number;
  verifyTimeoutSec: number;
  referenceFiles: string[];
  instructionFiles: string[];
  modelFallbacks: ModelFallbackEntry[];
  planningModel: ModelProfile | null;
  editModel: ModelProfile | null;
  /** When true, Web UI settings.json overrides LLM_* env bootstrap. */
  settingsOverrideEnv: boolean;
}

export function defaultAutoApprove(): AutoApproveSettings {
  return {
    enabled: false,
    newFilesOnly: false,
    pathPrefix: "",
    allowShellCommands: false,
  };
}

export function defaultAgentSettings(): AgentSettings {
  const envFirst = Number(process.env.BLANK_CLOUD_AGENT_FIRST_RESPONSE_MS);
  const firstSec =
    envFirst > 0 ? Math.max(5, Math.round(envFirst / 1000)) : 60;
  return {
    firstResponseTimeoutSec: firstSec,
    maxFilesPerStep: 3,
    autoApprove: defaultAutoApprove(),
    verifyCommand: process.env.BLANK_CLOUD_VERIFY_COMMAND?.trim() || "",
    verifyMaxRetries: 3,
    verifyTimeoutSec: 300,
    referenceFiles: [],
    instructionFiles: ["AGENTS.md", ".blank-cloud/AGENTS.md"],
    modelFallbacks: [
      {
        id: "nim-glm-fast",
        label: "NIM glm-5.3-flash (fast)",
        provider: "nim",
        model: "z-ai/glm-5.3-flash",
      },
    ],
    planningModel: {
      provider: "nim",
      model: "z-ai/glm-5.3-flash",
    },
    editModel: {
      provider: "nim",
      model: "z-ai/glm-5.3-flash",
    },
    settingsOverrideEnv: true,
  };
}

export function mergeAgentSettings(raw: Partial<AgentSettings> | undefined): AgentSettings {
  const base = defaultAgentSettings();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    autoApprove: { ...base.autoApprove, ...(raw.autoApprove ?? {}) },
    referenceFiles: raw.referenceFiles ?? base.referenceFiles,
    instructionFiles: raw.instructionFiles ?? base.instructionFiles,
    modelFallbacks: raw.modelFallbacks ?? base.modelFallbacks,
    planningModel: raw.planningModel ?? base.planningModel,
    editModel: raw.editModel ?? base.editModel,
  };
}

export function getFirstResponseTimeoutMs(settings: AgentSettings): number {
  const sec = settings.firstResponseTimeoutSec;
  if (sec > 0) return sec * 1000;
  const env = Number(process.env.BLANK_CLOUD_AGENT_FIRST_RESPONSE_MS);
  return env > 0 ? env : 60_000;
}
