import type { LlmProvider } from "../config.js";

export function formatAgentError(
  err: unknown,
  context?: { provider?: LlmProvider },
): string {
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
  const statusCode = e.statusCode;

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

  if (statusCode === 401 || /unauthorized|invalid api key/i.test(detail)) {
    return `Authentication failed — check the API key for your selected provider in Settings. (${detail})`;
  }

  if (statusCode === 404 || /not found/i.test(detail)) {
    return `Model or endpoint not found — verify the model name and base URL in Settings. (${detail})`;
  }

  if (statusCode === 410 || detail.toLowerCase() === "gone") {
    if (context?.provider === "nim") {
      return (
        "NVIDIA NIM returned HTTP 410 Gone on chat completions. " +
        "This is usually an account permission issue (not a wrong model id): your build.nvidia.com org may lack " +
        '"Public API Endpoints" — email help@build.nvidia.com with your login email and API key prefix, or use ' +
        "self-hosted NIM on your LAN (base URL like http://HOST:8000/v1). Use Settings → Test connection after saving."
      );
    }
    return (
      "LLM API returned HTTP 410 Gone — that endpoint is not available for your account. " +
      "Check provider, model, and base URL in Settings."
    );
  }

  if (/provider.*not configured/i.test(detail)) {
    return detail;
  }

  return statusCode ? `LLM request failed (HTTP ${statusCode}): ${detail}` : detail;
}
