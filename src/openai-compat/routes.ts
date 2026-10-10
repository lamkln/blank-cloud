import { Hono } from "hono";
import { z } from "zod";
import { assertOpenAiCompatAuth, isOpenAiCompatEnabled } from "./auth.js";
import { runCodingAgentForOpenAiCompat } from "./agent-chat.js";
import { formatAgentError } from "../agent/errors.js";
import { getRuntimeSettings } from "../config.js";

const openai = new Hono();

const AGENT_MODEL_ID = "blank-cloud-agent";

const chatSchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().optional(),
});

function unauthorized(c: { json: (body: unknown, status: number) => Response }) {
  return c.json(
    {
      error: {
        message: "Invalid or missing API key. Set Authorization: Bearer <BLANK_CLOUD_API_KEY>.",
        type: "invalid_request_error",
      },
    },
    401,
  );
}

function disabled(c: { json: (body: unknown, status: number) => Response }) {
  return c.json(
    {
      error: {
        message:
          "OpenAI-compatible API is disabled. Set BLANK_CLOUD_API_KEY in .env and restart.",
        type: "configuration_error",
      },
    },
    503,
  );
}

openai.get("/models", (c) => {
  if (!isOpenAiCompatEnabled()) return disabled(c);
  if (!assertOpenAiCompatAuth(c.req.header("Authorization"))) return unauthorized(c);
  const runtime = getRuntimeSettings();
  return c.json({
    object: "list",
    data: [
      {
        id: AGENT_MODEL_ID,
        object: "model",
        owned_by: "blank-cloud",
      },
      {
        id: `grok-coding-${runtime.provider}`,
        object: "model",
        owned_by: "blank-cloud",
      },
    ],
  });
});

openai.post("/chat/completions", async (c) => {
  if (!isOpenAiCompatEnabled()) return disabled(c);
  if (!assertOpenAiCompatAuth(c.req.header("Authorization"))) return unauthorized(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body" } }, 400);
  }
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: "Invalid chat completion request" } }, 400);
  }
  if (parsed.data.stream) {
    return c.json(
      {
        error: {
          message: "Streaming not supported yet. Set stream: false.",
          type: "invalid_request_error",
        },
      },
      400,
    );
  }

  try {
    const content = await runCodingAgentForOpenAiCompat(parsed.data.messages);
    const id = `chatcmpl-${Date.now()}`;
    return c.json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: parsed.data.model ?? AGENT_MODEL_ID,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: {
          message: formatAgentError(err, { provider: getRuntimeSettings().provider }),
          detail: message,
          type: "agent_error",
        },
      },
      500,
    );
  }
});

export { openai as openAiCompatRoutes, AGENT_MODEL_ID };
