import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelProfile } from "../settings/agent-settings.js";
import {
  DEFAULT_GROK_BASE_URL,
  DEFAULT_NIM_BASE_URL,
  getApiKeyForProvider,
  getNimBaseUrl,
  loadAppSettings,
  type LlmProvider,
} from "../settings/store.js";

export type ModelRole = "default" | "planning" | "edit";

function requireKey(value: string): string {
  const v = value.trim();
  if (!v) {
    throw new Error("API key missing — set it in Settings (Web UI).");
  }
  return v;
}

export function createLanguageModelForProfile(profile: ModelProfile): LanguageModel {
  const settings = loadAppSettings();
  const provider = profile.provider;
  const model = profile.model.trim();
  if (!model) {
    throw new Error(`Model id is required for provider ${provider}`);
  }

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: requireKey(getApiKeyForProvider("openai", settings)) });
      return openai(model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: requireKey(getApiKeyForProvider("anthropic", settings)),
      });
      return anthropic(model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: requireKey(getApiKeyForProvider("gemini", settings)),
      });
      return google(model);
    }
    case "groq": {
      const groq = createGroq({ apiKey: requireKey(getApiKeyForProvider("groq", settings)) });
      return groq(model);
    }
    case "grok": {
      const xai = createOpenAI({
        apiKey: requireKey(getApiKeyForProvider("grok", settings)),
        baseURL: DEFAULT_GROK_BASE_URL.replace(/\/$/, ""),
        compatibility: "compatible",
      });
      return xai(model);
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey: requireKey(getApiKeyForProvider("openrouter", settings)),
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": "https://github.com/blank-cloud",
          "X-Title": "blank-cloud",
        },
      });
      return openrouter(model);
    }
    case "nim": {
      const base = (profile.customBaseUrl?.trim() || getNimBaseUrl(settings)).replace(/\/$/, "");
      const nim = createOpenAI({
        apiKey: requireKey(getApiKeyForProvider("nim", settings)),
        baseURL: base || DEFAULT_NIM_BASE_URL,
        compatibility: "compatible",
      });
      return nim(model);
    }
    case "custom": {
      const base = (profile.customBaseUrl?.trim() || settings.customBaseUrl).trim();
      if (!base) {
        throw new Error("Custom provider requires a base URL in Settings.");
      }
      const openai = createOpenAI({
        apiKey: requireKey(getApiKeyForProvider("custom", settings)),
        baseURL: base.replace(/\/$/, ""),
        compatibility: "compatible",
      });
      return openai(model);
    }
    default:
      throw new Error(`Unknown provider: ${provider as LlmProvider}`);
  }
}

export function createLanguageModelForRole(role: ModelRole = "default"): LanguageModel {
  const settings = loadAppSettings();
  const profile: ModelProfile =
    role === "planning" && settings.agent.planningModel
      ? settings.agent.planningModel
      : role === "edit" && settings.agent.editModel
        ? settings.agent.editModel
        : {
            provider: settings.provider,
            model: settings.model,
            customBaseUrl: settings.customBaseUrl,
          };
  return createLanguageModelForProfile(profile);
}
