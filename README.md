# blank-cloud

Self-hosted AI coding agent in a single Docker container: chat API, repository tools, and a command runner. No Cursor and no third-party agent cloud — your code and API keys stay on the Linux host.

```bash
curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/install.sh | bash
```

If that URL fails, use the GitHub redirect (same file):

```bash
curl -fsSL https://github.com/lamkln/blank-cloud/raw/main/install.sh | bash
```

Requires **git**, **Docker**, and **Docker Compose v2** on Linux. The script clones to `~/blank-cloud`, creates `.env`, and builds the `blank-cloud` image. Set an API key in `~/blank-cloud/.env`, then run `cd ~/blank-cloud && docker compose up -d`.

Installer options (prefix the command): `BLANK_CLOUD_INSTALL_DIR`, `BLANK_CLOUD_PROJECT`, `BLANK_CLOUD_REF` (default `main`), `BLANK_CLOUD_START=1` to start in the background after build.

## Quick start (manual)

1. Clone this repository and create a `.env` file next to `docker-compose.yml` (see [API keys](#api-keys)).
2. Point `BLANK_CLOUD_PROJECT` at the repo you want the agent to edit (default: `./project`).
3. Build and run:

```bash
docker compose up --build
```

The agent listens on **http://localhost:8787**. Your project is mounted at `/workspace` inside the container.

## docker-compose.yml

```yaml
services:
  blank-cloud:
    image: blank-cloud
    build: .
    ports:
      - "8787:8787"
    volumes:
      - ${BLANK_CLOUD_PROJECT:-./project}:/workspace
    environment:
      PORT: "8787"
      WORKSPACE: /workspace
      # Provider: openai | anthropic | gemini | groq | openrouter | custom
      LLM_PROVIDER: ${LLM_PROVIDER:-openai}
      LLM_MODEL: ${LLM_MODEL:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      GOOGLE_GENERATIVE_AI_API_KEY: ${GOOGLE_GENERATIVE_AI_API_KEY:-}
      GROQ_API_KEY: ${GROQ_API_KEY:-}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
      CUSTOM_OPENAI_BASE_URL: ${CUSTOM_OPENAI_BASE_URL:-}
      CUSTOM_OPENAI_API_KEY: ${CUSTOM_OPENAI_API_KEY:-}
```

## API keys

Set keys **only** in the container environment (Compose `.env`, `environment:` block, or `docker run -e`). They are never stored or returned by the HTTP API.

Example `.env`:

```bash
BLANK_CLOUD_PROJECT=/home/you/your-app
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
# LLM_MODEL=gpt-4o   # optional; provider default used if omitted
```

| Provider     | `LLM_PROVIDER` | Environment variable              |
|-------------|----------------|-----------------------------------|
| OpenAI      | `openai`       | `OPENAI_API_KEY`                  |
| Anthropic   | `anthropic`    | `ANTHROPIC_API_KEY`               |
| Gemini      | `gemini`       | `GOOGLE_GENERATIVE_AI_API_KEY`    |
| Groq        | `groq`         | `GROQ_API_KEY`                    |
| OpenRouter  | `openrouter`   | `OPENROUTER_API_KEY`              |
| Custom OpenAI-compatible | `custom` | `CUSTOM_OPENAI_BASE_URL`, `CUSTOM_OPENAI_API_KEY` |

Switch provider or model at runtime (no keys via API):

```bash
curl -s http://localhost:8787/settings | jq
curl -s -X PATCH http://localhost:8787/settings \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","model":"claude-sonnet-4-20250514"}' | jq
```

## Agent workflow

1. **POST /tasks** with a natural-language task.
2. The agent lists and reads files under `/workspace`, then calls **propose_changes** with full file contents and optional shell commands.
3. The task moves to **awaiting_approval**. Stream logs on **GET /tasks/:id/stream** (SSE).
4. **POST /tasks/:id/approve** writes files, runs approved commands in the container, and streams stdout/stderr.
5. If a command fails, the agent inspects again and proposes a fix (back to step 3).
6. **POST /tasks/:id/undo** reverts the last approved file write batch.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness and workspace path |
| `GET` | `/settings` | Active provider/model and which providers have keys configured |
| `PATCH` | `/settings` | Change `provider`, `model`, or `customBaseUrl` |
| `POST` | `/tasks` | Body: `{ "prompt": "..." }` → `{ id, status, stream }` |
| `GET` | `/tasks/:id` | Task status and pending proposal |
| `POST` | `/tasks/:id/approve` | Apply pending proposal and run its commands |
| `POST` | `/tasks/:id/undo` | Undo last applied proposal |
| `GET` | `/tasks/:id/stream` | Server-Sent Events log stream |

### Example session

```bash
# Start a task
TASK=$(curl -s -X POST http://localhost:8787/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Add a hello function to main.py and run tests if present"}' )
echo "$TASK" | jq
ID=$(echo "$TASK" | jq -r .id)

# Follow logs (SSE)
curl -N "http://localhost:8787/tasks/$ID/stream"

# After status is awaiting_approval and you agree with the proposal:
curl -s -X POST "http://localhost:8787/tasks/$ID/approve" | jq

# Revert last apply if needed:
curl -s -X POST "http://localhost:8787/tasks/$ID/undo" | jq
```

## Development (without Docker)

```bash
npm install
WORKSPACE=./project npm run dev
```

## Security notes

- The agent runs shell commands you approve, inside the container, on the mounted project.
- Mount only repositories you trust. Path operations are constrained to `/workspace`.
- Expose port `8787` only on trusted networks; there is no built-in auth.

## License

MIT
