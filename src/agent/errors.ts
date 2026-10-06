import { RetryError } from "ai";
import type { LlmProvider } from "../config.js";
import { getRuntimeSettings } from "../config.js";

export const NIM_HTTP_410_MESSAGE =
  "NVIDIA NIM returned HTTP 410 Gone on chat completions. " +
  "This is usually an account permission issue (not a wrong model id): your build.nvidia.com org may lack " +
  '"Public API Endpoints" — email help@build.nvidia.com with your login email and API key prefix, or use ' +
  "self-hosted NIM on your LAN (base URL like http://HOST:8000/v1). In Settings: Save, Load NIM models, Test connection.";

function resolveProvider(context?: { provider?: LlmProvider }): LlmProvider {
  if (context?.provider) return context.provider;
  try {
    return getRuntimeSettings().provider;
  } catch {
    return "openai";
  }
}

function resolveStatusCode(
  statusCode: number | undefined,
  detail: string,
  url?: string,
): number | undefined {
  if (typeof statusCode === "number") return statusCode;
  const haystack = `${detail} ${url ?? ""}`;
  if (/410/.test(haystack) && /gone/i.test(haystack)) return 410;
  if (detail.trim().toLowerCase() === "gone") return 410;
  const m = haystack.match(/\b(401|403|404|410|429|500|502|503)\b/);
  return m ? Number(m[1]) : undefined;
}

function isNimContext(provider: LlmProvider, url?: string): boolean {
  if (provider === "nim") return true;
  if (url && /nvidia\.com/i.test(url)) return true;
  return false;
}

export function formatAgentError(
  err: unknown,
  context?: { provider?: LlmProvider },
): string {
  if (RetryError.isInstance(err)) {
    const inner = err.lastError ?? err.errors[err.errors.length - 1];
    const formatted = formatAgentError(inner, context);
    if (/internal server error/i.test(formatted)) {
      return (
        `${formatted} Check Settings → provider, model, and Test connection. ` +
        "Some endpoints reject streaming with tools; blank-cloud retries in standard mode when that happens."
      );
    }
    return formatted;
  }

  if (!err || typeof err !== "object") {
    return String(err);
  }

  const e = err as Error & {
    statusCode?: number;
    responseBody?: string;
    url?: string;
    cause?: unknown;
  };

  let detail = e.message || "Unknown error";
  const provider = resolveProvider(context);

  if (e.responseBody) {
    try {
      const parsed = JSON.parse(e.responseBody) as {
        error?: { message?: string; code?: string };
        message?: string;
        detail?: string;
      };
      const apiMsg = parsed.error?.message ?? parsed.message ?? parsed.detail;
      if (apiMsg) detail = apiMsg;
    } catch {
      if (e.responseBody.length < 500) {
        detail = e.responseBody;
      }
    }
  }

  if (e.cause instanceof Error && !detail.includes(e.cause.message)) {
    detail = `${detail} (${e.cause.message})`;
  }

  const statusCode = resolveStatusCode(e.statusCode, detail, e.url);

  if (statusCode === 401 || /unauthorized|invalid api key/i.test(detail)) {
    return `Authentication failed — check the API key for your selected provider in Settings. (${detail})`;
  }

  if (statusCode === 404 || /not found/i.test(detail)) {
    return `Model or endpoint not found — verify the model name and base URL in Settings. (${detail})`;
  }

  if (statusCode === 410 || detail.toLowerCase() === "gone") {
    if (isNimContext(provider, e.url)) {
      return NIM_HTTP_410_MESSAGE;
    }
    return (
      "LLM API returned HTTP 410 Gone — that endpoint is not available for your account. " +
      "Check provider, model, and base URL in Settings."
    );
  }

  if (/provider.*not configured/i.test(detail)) {
    return detail;
  }

  if (statusCode === 429 || /rate limit/i.test(detail)) {
    return `Rate limited — wait a moment or switch model/provider. (${detail})`;
  }

  if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    return (
      `LLM provider error (HTTP ${statusCode}): ${detail}. ` +
      "Verify your API key, model name, and base URL in Settings, then use Test connection."
    );
  }

  if (/internal server error/i.test(detail)) {
    return (
      `LLM provider error: ${detail}. ` +
      "Verify your API key, model name, and base URL in Settings, then use Test connection."
    );
  }

  return statusCode ? `LLM request failed (HTTP ${statusCode}): ${detail}` : detail;
}
