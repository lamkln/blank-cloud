import fs from "node:fs";
import path from "node:path";
import {
  getApiKeyForProvider,
  isProviderConfigured,
  listProvidersPublic,
  loadAppSettings,
  type AppSettings,
  updateAppSettings,
} from "./settings/store.js";

export type { LlmProvider } from "./settings/store.js";
export { DEFAULT_MODELS, parseProvider } from "./settings/store.js";

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.WORKSPACE || "/workspace");
}

export function getPort(): number {
  return Number(process.env.PORT || 8787);
}

export interface RuntimeSettings {
  provider: import("./settings/store.js").LlmProvider;
  model: string;
  customBaseUrl: string;
}

export function getRuntimeSettings(): RuntimeSettings {
  const s = loadAppSettings();
  return { provider: s.provider, model: s.model, customBaseUrl: s.customBaseUrl };
}

export function setRuntimeSettings(partial: Partial<RuntimeSettings>): RuntimeSettings {
  updateAppSettings(partial);
  return getRuntimeSettings();
}

export function getAppSettings(): AppSettings {
  return loadAppSettings();
}

export function listConfiguredProviders() {
  return listProvidersPublic();
}

export function assertProviderConfigured(
  provider: import("./settings/store.js").LlmProvider,
): void {
  if (!isProviderConfigured(provider)) {
    throw new Error(
      `Provider "${provider}" is not configured. Add an API key in Settings (Web UI).`,
    );
  }
}

export function getProviderApiKey(
  provider: import("./settings/store.js").LlmProvider,
): string {
  return getApiKeyForProvider(provider);
}

export function ensureWorkspace(): void {
  const root = getWorkspaceRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
}
