export function formatAgentError(err: unknown): string {
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
  let statusCode = e.statusCode;

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
    return (
      "LLM API returned HTTP 410 Gone — that model or endpoint is no longer available. " +
      "In Settings, pick a current model id (for NVIDIA NIM, use a model from build.nvidia.com) and confirm the base URL."
    );
  }

  if (/provider.*not configured/i.test(detail)) {
    return detail;
  }

  return statusCode ? `LLM request failed (HTTP ${statusCode}): ${detail}` : detail;
}
