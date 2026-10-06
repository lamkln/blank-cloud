import fs from "node:fs";
import path from "node:path";

export type LlmProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openrouter"
  | "nim"
  | "custom";

export const DEFAULT_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-4o",
  nim: "meta/llama-3.1-8b-instruct",
  custom: "gpt-4o",
};

export function parseProvider(raw: string | undefined): LlmProvider {
  const v = (raw ?? "openai").toLowerCase();
  if (v === "nvidia-nim" || v === "nvidia_nim") {
    return "nim";
  }
  if (
    v === "openai" ||
    v === "anthropic" ||
    v === "gemini" ||
    v === "groq" ||
    v === "openrouter" ||
    v === "nim" ||
    v === "custom"
  ) {
    return v;
  }
  return "openai";
}

export interface ProviderKeys {
  openai: string;
  anthropic: string;
  gemini: string;
  groq: string;
  openrouter: string;
  nim: string;
  customApiKey: string;
}

/** Git remote source (GitHub, GitLab, or any git HTTPS/SSH URL). */
export interface RepoSettings {
  remoteUrl: string;
  branch: string;
  gitToken: string;
  /** After approve, commit applied files and push to origin. */
  pushOnApprove: boolean;
}

export interface AppSettings {
  provider: LlmProvider;
  model: string;
  customBaseUrl: string;
  keys: ProviderKeys;
  repo: RepoSettings;
}

const KEY_FIELDS: Record<LlmProvider, keyof ProviderKeys | "customBaseUrl"> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  groq: "groq",
  openrouter: "openrouter",
  nim: "nim",
  custom: "customApiKey",
};

let cached: AppSettings | null = null;

export function getDataDir(): string {
  return path.resolve(process.env.BLANK_CLOUD_DATA || "/app/data");
}

function settingsPath(): string {
  return path.join(getDataDir(), "settings.json");
}

function keysFromEnv(): ProviderKeys {
  return {
    openai: process.env.OPENAI_API_KEY?.trim() || "",
    anthropic: process.env.ANTHROPIC_API_KEY?.trim() || "",
    gemini: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
    groq: process.env.GROQ_API_KEY?.trim() || "",
    openrouter: process.env.OPENROUTER_API_KEY?.trim() || "",
    nim: process.env.NIM_API_KEY?.trim() || "",
    customApiKey: process.env.CUSTOM_OPENAI_API_KEY?.trim() || "",
  };
}

function defaultNimBaseUrl(): string {
  return process.env.NIM_BASE_URL?.trim() || DEFAULT_NIM_BASE_URL;
}

function repoFromEnv(): RepoSettings {
  return {
    remoteUrl: process.env.BLANK_CLOUD_REPO_URL?.trim() || "",
    branch: process.env.BLANK_CLOUD_REPO_BRANCH?.trim() || "main",
    gitToken:
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GIT_TOKEN?.trim() ||
      process.env.BLANK_CLOUD_GIT_TOKEN?.trim() ||
      "",
    pushOnApprove: process.env.BLANK_CLOUD_PUSH_ON_APPROVE === "1",
  };
}

function defaultSettings(): AppSettings {
  const provider = parseProvider(process.env.LLM_PROVIDER);
  const baseUrl =
    provider === "nim"
      ? defaultNimBaseUrl()
      : process.env.CUSTOM_OPENAI_BASE_URL?.trim() || "";
  return {
    provider,
    model: process.env.LLM_MODEL?.trim() || DEFAULT_MODELS[provider],
    customBaseUrl: baseUrl,
    keys: keysFromEnv(),
    repo: repoFromEnv(),
  };
}

export function getNimBaseUrl(settings: AppSettings): string {
  return settings.customBaseUrl.trim() || DEFAULT_NIM_BASE_URL;
}

export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadAppSettings(): AppSettings {
  if (cached) {
    return cached;
  }
  ensureDataDir();
  const file = settingsPath();
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppSettings>;
      const base = defaultSettings();
      cached = {
        provider: parseProvider(raw.provider ?? base.provider),
        model: raw.model?.trim() || base.model,
        customBaseUrl: raw.customBaseUrl?.trim() ?? base.customBaseUrl,
        keys: { ...base.keys, ...(raw.keys ?? {}) },
        repo: { ...base.repo, ...(raw.repo ?? {}) },
      };
      return cached;
    } catch {
      /* fall through */
    }
  }
  cached = defaultSettings();
  persistAppSettings(cached);
  return cached;
}

export function persistAppSettings(settings: AppSettings): void {
  ensureDataDir();
  cached = settings;
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function updateAppSettings(
  partial: Partial<Omit<AppSettings, "keys" | "repo">> & {
    keys?: Partial<ProviderKeys>;
    repo?: Partial<RepoSettings>;
  },
): AppSettings {
  const current = loadAppSettings();
  const next: AppSettings = {
    ...current,
    ...partial,
    keys: { ...current.keys, ...(partial.keys ?? {}) },
    repo: { ...current.repo, ...(partial.repo ?? {}) },
  };
  if (partial.provider && partial.provider !== current.provider) {
    next.model = DEFAULT_MODELS[partial.provider];
  } else if (partial.model?.trim()) {
    next.model = partial.model.trim();
  }
  if (partial.provider === "nim" && !next.customBaseUrl.trim()) {
    next.customBaseUrl = DEFAULT_NIM_BASE_URL;
  }
  if (partial.customBaseUrl !== undefined) {
    next.customBaseUrl = partial.customBaseUrl.trim();
  }
  persistAppSettings(next);
  return next;
}

export function getApiKeyForProvider(provider: LlmProvider, settings = loadAppSettings()): string {
  const field = KEY_FIELDS[provider];
  return settings.keys[field as keyof ProviderKeys];
}

export function isProviderConfigured(provider: LlmProvider, settings = loadAppSettings()): boolean {
  if (provider === "custom") {
    return Boolean(settings.customBaseUrl.trim() && settings.keys.customApiKey.trim());
  }
  if (provider === "nim") {
    return Boolean(settings.keys.nim.trim());
  }
  return Boolean(getApiKeyForProvider(provider, settings).trim());
}

export function maskSecret(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length <= 6) return "••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function maskedKeys(settings: AppSettings): Record<keyof ProviderKeys, string | null> {
  return {
    openai: maskSecret(settings.keys.openai),
    anthropic: maskSecret(settings.keys.anthropic),
    gemini: maskSecret(settings.keys.gemini),
    groq: maskSecret(settings.keys.groq),
    openrouter: maskSecret(settings.keys.openrouter),
    nim: maskSecret(settings.keys.nim),
    customApiKey: maskSecret(settings.keys.customApiKey),
  };
}

export function listProvidersPublic(settings = loadAppSettings()) {
  return (Object.keys(DEFAULT_MODELS) as LlmProvider[]).map((id) => ({
    id,
    configured: isProviderConfigured(id, settings),
    defaultModel: DEFAULT_MODELS[id],
  }));
}

export function maskedRepo(settings: AppSettings): Omit<RepoSettings, "gitToken"> & {
  gitToken: string | null;
} {
  return {
    remoteUrl: settings.repo.remoteUrl,
    branch: settings.repo.branch,
    pushOnApprove: settings.repo.pushOnApprove,
    gitToken: maskSecret(settings.repo.gitToken),
  };
}

export function getManagedWorkspacePath(): string {
  return path.join(getDataDir(), "workspace");
}

export function usesRemoteRepo(settings = loadAppSettings()): boolean {
  return Boolean(settings.repo.remoteUrl.trim());
}

export function resolveWorkspaceRoot(settings = loadAppSettings()): string {
  if (usesRemoteRepo(settings)) {
    return getManagedWorkspacePath();
  }
  return path.resolve(process.env.WORKSPACE || "/workspace");
}

export { KEY_FIELDS };
