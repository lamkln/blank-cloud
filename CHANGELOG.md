# Changelog

## 0.5.0

- **Automatic task planning** — large prompts split into a checklist (3–8 steps); each step runs in its own model turn with a per-step file cap (default 3).
- **Progress UI** — waiting timer, provider/model, Cancel/Retry; reasoning deltas streamed when available.
- **Configurable first-response timeout** in Settings (still overridable via `BLANK_CLOUD_AGENT_FIRST_RESPONSE_MS`).
- **Auto-approve** — workspace default + per-task flag; optional new-files-only / path prefix; shell commands off unless enabled.
- **Verify command** — run after each approve (e.g. `./gradlew build`); failures fed back to the agent (retry cap).
- **Project context** — `AGENTS.md`, reference file paths, workspace instruction files in agent system prompt.
- **Model fallback list** — try alternate provider/model profiles on timeout/429/5xx/410; **Test tools** exercises a tiny tool-calling request.
- **Planning vs edit models** — optional separate profiles in settings (`planningModel`, `editModel`).
- **Settings clarity** — resolved base URL, active key suffix, config source (UI vs env).
- **Streaming fix** — `consumeStream()` before awaiting `result.text` (ai SDK 4.3.x).

## 0.4.3

- OpenAI-compatible `/v1` API for Grok Bot; agent hang fixes for NIM/custom providers; PATCH settings robustness.
