import { Hono } from "hono";
import { z } from "zod";
import type { LlmProvider } from "../config.js";
import {
  getRuntimeSettings,
  listConfiguredProviders,
  setRuntimeSettings,
} from "../config.js";

const settings = new Hono();

const patchSchema = z.object({
  provider: z
    .enum(["openai", "anthropic", "gemini", "groq", "openrouter", "custom"])
    .optional(),
  model: z.string().min(1).optional(),
  customBaseUrl: z.string().optional(),
});

settings.get("/", (c) => {
  const runtime = getRuntimeSettings();
  return c.json({
    provider: runtime.provider,
    model: runtime.model,
    customBaseUrl: runtime.customBaseUrl || null,
    providers: listConfiguredProviders(),
    note: "API keys are read only from container environment variables, not this API.",
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
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const next = setRuntimeSettings(parsed.data as Partial<{
    provider: LlmProvider;
    model: string;
    customBaseUrl: string;
  }>);
  return c.json({
    provider: next.provider,
    model: next.model,
    customBaseUrl: next.customBaseUrl || null,
  });
});

export { settings as settingsRoutes };
