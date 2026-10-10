import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  assertProviderConfigured,
  getProviderApiKey,
  getRuntimeSettings,
} from "../config.js";
import {
  DEFAULT_GROK_BASE_URL,
  getNimBaseUrl,
  loadAppSettings,
} from "../settings/store.js";

export function createLanguageModel(): LanguageModel {
  const { provider, model, customBaseUrl } = getRuntimeSettings();
  assertProviderConfigured(provider);

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: requireKey(getProviderApiKey("openai")) });
      return openai(model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: requireKey(getProviderApiKey("anthropic")),
      });
      return anthropic(model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: requireKey(getProviderApiKey("gemini")),
      });
      return google(model);
    }
    case "groq": {
      const groq = createGroq({ apiKey: requireKey(getProviderApiKey("groq")) });
      return groq(model);
    }
    case "grok": {
      const xai = createOpenAI({
        apiKey: requireKey(getProviderApiKey("grok")),
        baseURL: DEFAULT_GROK_BASE_URL.replace(/\/$/, ""),
        compatibility: "compatible",
      });
      return xai(model);
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey: requireKey(getProviderApiKey("openrouter")),
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": "https://github.com/blank-cloud",
          "X-Title": "blank-cloud",
        },
      });
      return openrouter(model);
    }
    case "nim": {
      const settings = loadAppSettings();
      const nim = createOpenAI({
        apiKey: requireKey(getProviderApiKey("nim")),
        baseURL: getNimBaseUrl(settings).replace(/\/$/, ""),
        compatibility: "compatible",
      });
      return nim(model);
    }
    case "custom": {
      const base = customBaseUrl.trim();
      if (!base) {
        throw new Error("Custom provider requires a base URL in Settings.");
      }
      const openai = createOpenAI({
        apiKey: requireKey(getProviderApiKey("custom")),
        baseURL: base.replace(/\/$/, ""),
        compatibility: "compatible",
      });
      return openai(model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function requireKey(value: string): string {
  const v = value.trim();
  if (!v) {
    throw new Error("API key missing — set it in Settings (Web UI).");
  }
  return v;
}
