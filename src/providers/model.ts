import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  assertProviderConfigured,
  getRuntimeSettings,
  type LlmProvider,
} from "../config.js";

export function createLanguageModel(): LanguageModel {
  const { provider, model, customBaseUrl } = getRuntimeSettings();
  assertProviderConfigured(provider);

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
      return openai(model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: requiredEnv("ANTHROPIC_API_KEY"),
      });
      return anthropic(model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: requiredEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      });
      return google(model);
    }
    case "groq": {
      const groq = createGroq({ apiKey: requiredEnv("GROQ_API_KEY") });
      return groq(model);
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey: requiredEnv("OPENROUTER_API_KEY"),
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": "https://github.com/blank-cloud",
          "X-Title": "blank-cloud",
        },
      });
      return openrouter(model);
    }
    case "custom": {
      const base = customBaseUrl || requiredEnv("CUSTOM_OPENAI_BASE_URL");
      const openai = createOpenAI({
        apiKey: requiredEnv("CUSTOM_OPENAI_API_KEY"),
        baseURL: base.replace(/\/$/, ""),
      });
      return openai(model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return v;
}
