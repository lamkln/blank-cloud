# Using blank-cloud with external agents (Grok Bot, scripts)

## Two APIs

| API | Use when |
|-----|----------|
| `POST /v1/chat/completions` | OpenAI-compatible clients (Grok Bot). One HTTP request per agent turn. Set `BLANK_CLOUD_API_KEY`. |
| `POST /tasks` | Full control: planning, streaming events, auto-approve, templates, wait-for-done. |

## Recommended task size

- Prefer **3 files or fewer per `propose_changes`** (server default `maxFilesPerStep`).
- Large builds (Fabric mod, full app): let **automatic planning** split work, or pass a **template** (`template: "fabric-1.21"` copies from `data/templates/`).
- Enable **verify**: `./gradlew build` is auto-detected when `gradlew` exists.

## Auto-approve

```json
POST /tasks
{
  "prompt": "...",
  "autoApprove": true,
  "autoApproveRelaxRules": true,
  "wait": true,
  "waitTimeoutMs": 600000
}
```

- `autoApprove: true` — enable auto-approve for this task (still respects workspace `newFilesOnly` / `pathPrefix` unless relaxed).
- `autoApproveRelaxRules: true` — ignore path prefix and new-files-only for this task.
- `autoApproveAllowShell: true` — allow proposals that include post-accept shell commands.

Check `GET /tasks/:id` → `progress.lastAutoApproveReason` if the task stops in `awaiting_approval`.

## Wait without polling loops

- `GET /tasks/:id/wait?timeoutMs=120000` — blocks until terminal or approval state.
- `POST /tasks` with `"wait": true` — creates, runs, and returns the final task JSON.

## Grok Bot

Point custom model at `http://HOST:8787/v1`, model `blank-cloud-agent`. Configure LLM keys in the Web UI. For multi-step Fabric work, prefer `/tasks` with `wait` from a script, or split prompts manually in Grok.
