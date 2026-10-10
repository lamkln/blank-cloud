import { generateText, tool } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import type { LlmProvider } from "../config.js";
import { getRuntimeSettings } from "../config.js";
import { formatAgentError } from "../agent/errors.js";
import { createLanguageModel } from "../providers/model.js";
import {
  getApiKeyForProvider,
  getNimBaseUrl,
  loadAppSettings,
  maskSecret,
  maskedKeys,
  updateAppSettings,
  listProvidersPublic,
} from "../settings/store.js";
import { runWithModelFallback } from "../providers/fallback.js";
import { proposeChangesArgsSchema } from "../tasks/tool-args.js";

const settings = new Hono();

const keysSchema = z
  .object({
    openai: z.string().optional(),
    anthropic: z.string().optional(),
    gemini: z.string().optional(),
    groq: z.string().optional(),
    grok: z.string().optional(),
    openrouter: z.string().optional(),
    nim: z.string().optional(),
    customApiKey: z.string().optional(),
  })
  .optional();

const agentPatchSchema = z
  .object({
    firstResponseTimeoutSec: z.number().int().min(5).max(600).optional(),
    maxFilesPerStep: z.number().int().min(1).max(20).optional(),
    verifyCommand: z.string().optional(),
    verifyMaxRetries: z.number().int().min(0).max(10).optional(),
    verifyTimeoutSec: z.number().int().min(10).max(3600).optional(),
    referenceFiles: z.array(z.string()).optional(),
    instructionFiles: z.array(z.string()).optional(),
    modelFallbacks: z.array(z.any()).optional(),
    planningModel: z.any().nullable().optional(),
    editModel: z.any().nullable().optional(),
    settingsOverrideEnv: z.boolean().optional(),
    autoApprove: z
      .object({
        enabled: z.boolean().optional(),
        newFilesOnly: z.boolean().optional(),
        pathPrefix: z.string().optional(),
        allowShellCommands: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

const patchSchema = z.object({
  provider: z
    .enum(["openai", "anthropic", "gemini", "groq", "grok", "openrouter", "nim", "custom"])
    .optional(),
  model: z.string().min(1).optional(),
  customBaseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  keys: keysSchema,
  agent: agentPatchSchema,
});

function resolvedBaseUrl(app: ReturnType<typeof loadAppSettings>): string | null {
  if (app.provider === "nim") {
    return getNimBaseUrl(app);
  }
  if (app.provider === "custom") {
    return app.customBaseUrl.trim() || null;
  }
  if (app.provider === "grok") {
    return "https://api.x.ai/v1";
  }
  return null;
}

settings.get("/", (c) => {
  const app = loadAppSettings();
  const runtime = getRuntimeSettings();
  const activeKey = getApiKeyForProvider(runtime.provider, app);
  return c.json({
    provider: runtime.provider,
    model: runtime.model,
    customBaseUrl: runtime.customBaseUrl || null,
    resolvedBaseUrl: resolvedBaseUrl(app),
    activeKeySuffix:
      activeKey.trim().length >= 4 ? activeKey.trim().slice(-4) : null,
    configWins: app.agent.settingsOverrideEnv ? "settings.json (Web UI)" : "env bootstrap",
    agent: app.agent,
    providers: listProvidersPublic(app),
    keys: maskedKeys(app),
    storage: "settings.json in BLANK_CLOUD_DATA (Web UI)",
  });
});

settings.get("/nim/models", async (c) => {
  const app = loadAppSettings();
  const key = app.keys.nim.trim();
  if (!key) {
    return c.json({ error: "Save an NVIDIA NIM API key first" }, 400);
  }
  const base = getNimBaseUrl(app).replace(/\/$/, "");
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return c.json(
      {
        error: `Could not list models (HTTP ${res.status})`,
        detail: text.slice(0, 300),
        base,
      },
      502,
    );
  }
  let ids: string[] = [];
  try {
    const json = JSON.parse(text) as { data?: { id: string }[] };
    ids = (json.data ?? []).map((m) => m.id).filter(Boolean).sort();
  } catch {
    return c.json({ error: "Unexpected models response from NIM" }, 502);
  }
  return c.json({ base, models: ids });
});

settings.get("/grok/models", async (c) => {
  const app = loadAppSettings();
  const key = app.keys.grok.trim();
  if (!key) {
    return c.json({ error: "Save an xAI (Grok) API key first" }, 400);
  }
  const res = await fetch("https://api.x.ai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return c.json(
      {
        error: `Could not list Grok models (HTTP ${res.status})`,
        detail: text.slice(0, 300),
      },
      502,
    );
  }
  let ids: string[] = [];
  try {
    const json = JSON.parse(text) as { data?: { id: string }[] };
    ids = (json.data ?? []).map((m) => m.id).filter(Boolean).sort();
  } catch {
    return c.json({ error: "Unexpected models response from xAI" }, 502);
  }
  return c.json({ models: ids });
});

settings.post("/test", async (c) => {
  const runtime = getRuntimeSettings();
  try {
    const result = await generateText({
      model: createLanguageModel(),
      prompt: "Reply with exactly: OK",
      maxTokens: 16,
    });
    return c.json({
      ok: true,
      provider: runtime.provider,
      model: runtime.model,
      reply: result.text.trim().slice(0, 200),
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        provider: runtime.provider,
        model: runtime.model,
        error: formatAgentError(err, { provider: runtime.provider }),
      },
      400,
    );
  }
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

  const patch: Record<string, unknown> = { keys: keyUpdates };
  if (data.provider !== undefined) patch.provider = data.provider;
  if (data.model !== undefined) patch.model = data.model;
  if (data.customBaseUrl !== undefined) patch.customBaseUrl = data.customBaseUrl;
  if (data.agent !== undefined) patch.agent = data.agent;

  const next = updateAppSettings(patch);

  return c.json({
    provider: next.provider,
    model: next.model,
    customBaseUrl: next.customBaseUrl || null,
    resolvedBaseUrl: resolvedBaseUrl(next),
    agent: next.agent,
    providers: listProvidersPublic(next),
    keys: maskedKeys(next),
  });
});

settings.post("/test-propose", async (c) => {
  const started = Date.now();
  try {
    await runWithModelFallback("settings-propose-test", "edit", async (model) => {
      const propose = tool({
        description: "Write one file",
        parameters: proposeChangesArgsSchema,
        execute: async ({ files }) => ({ ok: true, count: files.length }),
      });
      await generateText({
        model,
        tools: { propose_changes: propose },
        maxSteps: 2,
        prompt:
          'Call propose_changes once with summary "test" and files [{"path":"_blank_cloud_probe.txt","content":"ok"}] as a real array, not a string.',
        maxTokens: 256,
      });
    });
    return c.json({ ok: true, latencyMs: Date.now() - started, toolCalling: true });
  } catch (err) {
    return c.json(
      {
        ok: false,
        latencyMs: Date.now() - started,
        error: formatAgentError(err, { provider: getRuntimeSettings().provider }),
      },
      400,
    );
  }
});

settings.post("/test-tools", async (c) => {
  const started = Date.now();
  try {
    await runWithModelFallback("settings-tools-test", "edit", async (model, label) => {
      const ping = tool({
        description: "Health check",
        parameters: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true }),
      });
      await generateText({
        model,
        tools: { ping },
        maxSteps: 2,
        prompt: "Call the ping tool once with ok true, then reply DONE.",
        maxTokens: 64,
      });
      return label;
    });
    return c.json({ ok: true, latencyMs: Date.now() - started });
  } catch (err) {
    return c.json(
      {
        ok: false,
        latencyMs: Date.now() - started,
        error: formatAgentError(err, { provider: getRuntimeSettings().provider }),
      },
      400,
    );
  }
});

export { settings as settingsRoutes };
