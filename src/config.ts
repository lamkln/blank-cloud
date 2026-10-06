import fs from "node:fs";
import path from "node:path";

export type LlmProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openrouter"
  | "custom";

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-4o",
  custom: "gpt-4o",
};

export interface RuntimeSettings {
  provider: LlmProvider;
  model: string;
  customBaseUrl: string;
}

function parseProvider(raw: string | undefined): LlmProvider {
  const v = (raw ?? "openai").toLowerCase();
  if (
    v === "openai" ||
    v === "anthropic" ||
    v === "gemini" ||
    v === "groq" ||
    v === "openrouter" ||
    v === "custom"
  ) {
    return v;
  }
  return "openai";
}

const envProvider = parseProvider(process.env.LLM_PROVIDER);

let runtime: RuntimeSettings = {
  provider: envProvider,
  model: process.env.LLM_MODEL?.trim() || DEFAULT_MODELS[envProvider],
  customBaseUrl: process.env.CUSTOM_OPENAI_BASE_URL?.trim() || "",
};

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.WORKSPACE || "/workspace");
}

export function getPort(): number {
  return Number(process.env.PORT || 8787);
}

export function getRuntimeSettings(): RuntimeSettings {
  return { ...runtime };
}

export function setRuntimeSettings(partial: Partial<RuntimeSettings>): RuntimeSettings {
  if (partial.provider !== undefined) {
    runtime.provider = partial.provider;
    if (!process.env.LLM_MODEL?.trim()) {
      runtime.model = DEFAULT_MODELS[partial.provider];
    }
  }
  if (partial.model !== undefined && partial.model.trim()) {
    runtime.model = partial.model.trim();
  }
  if (partial.customBaseUrl !== undefined) {
    runtime.customBaseUrl = partial.customBaseUrl.trim();
  }
  return getRuntimeSettings();
}

export function listConfiguredProviders(): {
  id: LlmProvider;
  configured: boolean;
  defaultModel: string;
}[] {
  const checks: Record<LlmProvider, boolean> = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    custom: Boolean(
      process.env.CUSTOM_OPENAI_BASE_URL && process.env.CUSTOM_OPENAI_API_KEY,
    ),
  };
  return (Object.keys(DEFAULT_MODELS) as LlmProvider[]).map((id) => ({
    id,
    configured: checks[id],
    defaultModel: DEFAULT_MODELS[id],
  }));
}

export function assertProviderConfigured(provider: LlmProvider): void {
  const item = listConfiguredProviders().find((p) => p.id === provider);
  if (!item?.configured) {
    throw new Error(
      `Provider "${provider}" is not configured. Set the corresponding API key in the container environment.`,
    );
  }
}

export function ensureWorkspace(): void {
  const root = getWorkspaceRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
}
