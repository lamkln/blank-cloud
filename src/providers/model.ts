import type { LanguageModel } from "ai";
import { assertProviderConfigured, getRuntimeSettings } from "../config.js";
import { createLanguageModelForRole } from "./model-runtime.js";

export function createLanguageModel(): LanguageModel {
  const { provider } = getRuntimeSettings();
  assertProviderConfigured(provider);
  return createLanguageModelForRole("default");
}

export { createLanguageModelForRole, createLanguageModelForProfile } from "./model-runtime.js";
export type { ModelRole } from "./model-runtime.js";
