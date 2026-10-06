import { Hono } from "hono";
import { z } from "zod";
import type { LlmProvider } from "../config.js";
import { getRuntimeSettings } from "../config.js";
import {
  loadAppSettings,
  maskedKeys,
  updateAppSettings,
  listProvidersPublic,
} from "../settings/store.js";

const settings = new Hono();

const keysSchema = z
  .object({
    openai: z.string().optional(),
    anthropic: z.string().optional(),
    gemini: z.string().optional(),
    groq: z.string().optional(),
    openrouter: z.string().optional(),
    nim: z.string().optional(),
    customApiKey: z.string().optional(),
  })
  .optional();

const patchSchema = z.object({
  provider: z
    .enum(["openai", "anthropic", "gemini", "groq", "openrouter", "nim", "custom"])
    .optional(),
  model: z.string().min(1).optional(),
  customBaseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  keys: keysSchema,
});

settings.get("/", (c) => {
  const app = loadAppSettings();
  const runtime = getRuntimeSettings();
  return c.json({
    provider: runtime.provider,
    model: runtime.model,
    customBaseUrl: runtime.customBaseUrl || null,
    providers: listProvidersPublic(app),
    keys: maskedKeys(app),
    storage: "settings.json in BLANK_CLOUD_DATA (Web UI)",
  });
});

settings.patch("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid settings", details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const keyUpdates: Record<string, string> = {};

  if (data.keys) {
    for (const [k, v] of Object.entries(data.keys)) {
      if (typeof v === "string" && v.trim()) {
        keyUpdates[k] = v.trim();
      }
    }
  }

  if (data.apiKey?.trim()) {
    const provider = (data.provider ?? loadAppSettings().provider) as LlmProvider;
    const field =
      provider === "custom"
        ? "customApiKey"
        : provider === "gemini"
          ? "gemini"
          : provider === "openrouter"
            ? "openrouter"
            : provider === "nim"
              ? "nim"
              : provider;
    keyUpdates[field] = data.apiKey.trim();
  }

  const next = updateAppSettings({
    provider: data.provider,
    model: data.model,
    customBaseUrl: data.customBaseUrl,
    keys: keyUpdates,
  });

  return c.json({
    provider: next.provider,
    model: next.model,
    customBaseUrl: next.customBaseUrl || null,
    providers: listProvidersPublic(next),
    keys: maskedKeys(next),
  });
});

export { settings as settingsRoutes };
