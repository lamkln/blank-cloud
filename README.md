# blank-cloud

Self-hosted AI coding agent in a single Docker container: chat API, repository tools, and a command runner. No Cursor and no third-party agent cloud — your code and API keys stay on the Linux host.

### Install (recommended — no `raw.githubusercontent.com`)

Requires **git**, **Docker**, and **Docker Compose v2** on Linux.

```bash
git clone --depth 1 https://github.com/lamkln/blank-cloud.git ~/blank-cloud && bash ~/blank-cloud/install.sh
```

If `~/blank-cloud` already exists, either run from that folder (`bash install.sh` after `git pull`), or use another install path: `BLANK_CLOUD_INSTALL_DIR=~/blank-cloud-new bash ~/blank-cloud/install.sh`.

### Install (curl)

Use the **`/raw/main/`** URL. This is wrong and returns **404**:

`https://github.com/lamkln/blank-cloud/install.sh`

Working one-liners:

```bash
curl -fsSL https://github.com/lamkln/blank-cloud/raw/main/install.sh | bash
```

```bash
curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/install.sh | bash
```

Release asset (if the URLs above fail):

```bash
curl -fsSL https://github.com/lamkln/blank-cloud/releases/latest/download/install.sh | bash
```

Installer options (prefix the command): `BLANK_CLOUD_INSTALL_DIR`, `BLANK_CLOUD_PROJECT`, `BLANK_CLOUD_REF` (default `main`), `BLANK_CLOUD_START=1` to start in the background after build.

The installer creates `~/blank-cloud/.env`. Add your LLM API key in the Web UI (**Model**), then run `cd ~/blank-cloud && docker compose up -d`.

### UI won’t load (connection timed out)

Run these **on the NAS** (SSH or terminal), not on your laptop:

```bash
cd ~/blank-cloud
docker compose ps
docker compose logs --tail 80 blank-cloud
curl -s -m 5 http://127.0.0.1:8787/health || echo "not responding on host"
```

| Symptom | What to do |
|--------|------------|
| `ps` shows no container or `Exit` | `docker compose up -d --build` |
| `curl` works on NAS but not from PC | Use the NAS **LAN** IP (`192.168.x.x`, not `127.0.0.1`). Check typo: **`192.168`**, not `192.169`. |
| `curl` fails on NAS too | Read `logs` for crash (port in use, bad `data/` permissions). |
| After reboot | `cd ~/blank-cloud && docker compose up -d` (compose uses `restart: unless-stopped` on recent installs). |

From your PC: `curl -m 5 http://192.168.x.x:8787/health` (replace with real NAS IP).

### Works today (NAS quick path)

**Update** (on the host):

```bash
cd ~/blank-cloud && bash scripts/update.sh
```

**`git checkout -B main origin/main` / HTTP 400** — do **not** use `origin/main` as the checkout target. On the **NAS host**, reset by commit SHA (works even when `origin/main` is broken):

```bash
cd ~/blank-cloud
curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/cursor/ui-polish-d75c/scripts/recover-from-github.sh | bash -s ~/blank-cloud
docker compose up -d --build
```

Or manually:

```bash
cd ~/blank-cloud
SHA=$(git ls-remote https://github.com/lamkln/blank-cloud.git refs/heads/main | awk '{print $1}')
git fetch https://github.com/lamkln/blank-cloud.git "$SHA"
git checkout -B main "$SHA"
docker compose up -d --build
```

If `git ls-remote` fails, test: `curl -I https://github.com` and fix DNS/firewall on the host.

Hard refresh the browser after the container restarts.

**Manifest / custom OpenAI-compatible gateway** (e.g. `https://app.manifest.build/v1`):

1. Sidebar **System → Model** (opens settings).
2. Provider: **custom**, Base URL: your gateway `/v1` URL, API key, Model ID: **`auto`** (or the exact id from your gateway routing page).
3. **Save** → **Test connection** — status should show `custom / auto` (not `gpt-4o`).
4. Confirm: `curl -s http://localhost:8787/health | jq .llm` — `model` must match what you saved.

If `main` is behind and update does not pick up fixes yet, deploy the release branch once:

```bash
cd ~/blank-cloud && git fetch origin && git checkout cursor/ui-polish-d75c && bash scripts/update.sh
```

Then merge [PR #50](https://github.com/lamkln/blank-cloud/pull/50) when ready so `main` stays the default update target.

### Auto-update

The sidebar **Updates** panel checks [GitHub `main`](https://github.com/lamkln/blank-cloud) for new commits. Toggles:

- **Auto-check daily** — background check (default on)
- **Auto-apply when available** — runs `scripts/update.sh` when a update is found (only if one-click apply is enabled)

**Manual update on the host** (always works):

```bash
cd ~/blank-cloud && bash scripts/update.sh
```

**Optional cron** (no Web UI):

```bash
0 4 * * * BLANK_CLOUD_INSTALL_DIR=$HOME/blank-cloud $HOME/blank-cloud/scripts/auto-update-cron.sh
```

**One-click update from the Web UI** mounts your install directory and the Docker socket (trusted home/LAN only). The update script marks the mounted clone as a [safe Git directory](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory) so root inside the container can run `git fetch` on your host-owned `/install` tree.

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# Edit .env: BLANK_CLOUD_UPDATE_APPLY=1
docker compose up -d --build
```

Verify: `curl -s http://localhost:8787/health` includes `"ui":"auto-update"`.

### Out of the box

| What | Setup |
|------|--------|
| **Run the agent on local files** | Put or clone code in `~/blank-cloud/project` (installer runs `git init` there). No GitHub required. |
| **Connect GitHub** | Click **Connect GitHub** → approve on github.com/device (no PAT, no `.env` OAuth secret). Requires a **public OAuth Client ID** shipped with blank-cloud (`github-oauth-client-id` in the repo or `data/`). Official builds include this; forks add one line — see `github-oauth-client-id.bundled`. |
| **Optional redirect OAuth** | Set `GITHUB_OAUTH_CLIENT_SECRET` + `BLANK_CLOUD_PUBLIC_URL` in `.env` for browser redirect instead of device flow. |

## Repository source

blank-cloud edits a **real git workspace**, not just chat. Two ways to attach a repo:

### 1. Web UI — connect GitHub & pick a repo (Cursor-style)

In the sidebar **Repository** section you attach the git tree the agent edits.

#### Per-user GitHub (recommended for a shared NAS)

When the server is configured for **GitHub OAuth**, **each person signs in with their own GitHub account** (like Cursor): their token, repo list, clone, and agent runs are kept separate under `./data/users/` and `./data/workspaces/<login>/`.

1. Register a [GitHub OAuth App](https://github.com/settings/developers) (type: **Web application**).
   - **Authorization callback URL:** `{BLANK_CLOUD_PUBLIC_URL}/auth/github/callback`  
     Example: `http://192.168.1.50:8787/auth/github/callback`
2. Set env on the host (or in `~/blank-cloud/.env`):

```bash
GITHUB_OAUTH_CLIENT_ID=Ov23li...
GITHUB_OAUTH_CLIENT_SECRET=...
BLANK_CLOUD_PUBLIC_URL=http://YOUR_NAS_IP:8787   # must match how users open the UI
SESSION_SECRET=long-random-string                # signs login cookies
```

3. Restart: `docker compose up --build -d`
4. In the UI: **Connect GitHub** (no PAT to paste) → pick a repository → workspace shows **Ready**.
5. Optional: **Advanced** → **Commit & push after approve** (stored per user when OAuth is on).

**Shared commit brand** (display name on commits, e.g. `blank-cloud agent`) stays **global** in the sidebar — same idea as [@cursoragent](https://github.com/cursoragent); pushes still use **your** GitHub token and repos you can access.

#### Single-user / legacy (no OAuth env)

If OAuth env vars are **not** set, the server uses one shared PAT in settings (fine for one person):

1. Create a [GitHub personal access token](https://github.com/settings/tokens) with access to your repositories (fine-grained: **Contents** read/write; or classic `repo` scope).
2. Paste the token → **Connect (PAT)** (lists repos via the GitHub API).
3. **Search** and **click a repository** — blank-cloud clones to `./data/workspace` and marks the workspace **Ready**.

Optional **Sign in (device)** still appears if only `GITHUB_OAUTH_CLIENT_ID` is set without a client secret (device flow path).

Env bootstrap (optional, legacy):

```bash
GITHUB_TOKEN=ghp_...
BLANK_CLOUD_PUSH_ON_APPROVE=1
```

When a repository is selected (legacy mode), the agent uses **`./data/workspace`** instead of the `BLANK_CLOUD_PROJECT` mount. With OAuth, each signed-in user uses **`./data/workspaces/<github-login>/`**.

### Shared brand (like @cursoragent)

| Piece | OAuth (multi-user) | Legacy PAT |
|--------|-------------------|------------|
| **Repo access** | Each user’s GitHub after **Sign in** | One PAT in the sidebar |
| **Commit author** | Global **Shared brand — commits show as** (default `blank-cloud agent`) | Same |
| **Workspace** | `./data/workspaces/<login>/` | `./data/workspace` |

Set `BLANK_CLOUD_GIT_AUTHOR_NAME` if you want a different brand string in env.

### Optional: one bot PAT instead of per-user OAuth

If you prefer one shared bot account (every repo owner invites the bot):

1. **Create a GitHub account** for the bot (e.g. `your-blank-cloud-bot`) — same idea as [@cursoragent](https://github.com/cursoragent).
2. **Add the bot to your repo**: Settings → Collaborators (or org team with write access).
3. **Create a PAT** on the **bot account** (fine-grained: Contents read/write; or classic `repo` scope).
4. Leave OAuth env **unset**, paste the PAT → **Connect (PAT)**, pick a repo.

Commits appear under the bot profile when author email matches GitHub’s noreply address for that account.

Optional env:

```bash
BLANK_CLOUD_GIT_AUTHOR_NAME=blank-cloud agent
BLANK_CLOUD_GIT_AUTHOR_EMAIL=12345678+botlogin@users.noreply.github.com
BLANK_CLOUD_GITHUB_LOGIN=botlogin
```

### 2. Docker mount — existing checkout on the NAS

Leave **Remote URL** empty and set `BLANK_CLOUD_PROJECT` to a folder that already contains your repo:

```bash
BLANK_CLOUD_PROJECT=/home/you/your-app
```

## Quick start (manual)

1. Clone this repository and create a `.env` file next to `docker-compose.yml` (see [API keys](#api-keys)).
2. Point `BLANK_CLOUD_PROJECT` at the repo you want the agent to edit (default: `./project`).
3. Build and run:

```bash
docker compose up --build
```

The agent listens on **http://localhost:8787**. Your project is mounted at `/workspace` inside the container.

**Build error `open …/data/users: permission denied`:** `./data` is created by the container (often as root). It must not be sent as Docker build context — keep an up-to-date `.dockerignore` that lists `data` and `project`, then run `docker compose build` again.

Open **http://localhost:8787/** for the **Web UI** (Cursor Cloud Agent–style): agent runs in a chat thread, diff review in the side panel, **Approve / Reject**, follow-up messages, and undo. The JSON API remains on the same port.

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

## Model, provider & API keys

Configure everything in the **Web UI**: sidebar → **Model** → set provider, model, and API keys → **Save settings**.

Keys are stored in **`./data/settings.json`** on the host (mounted at `/app/data` in the container). They persist across restarts. The API returns **masked** keys only (`sk-…abcd`).

Optional: seed defaults from Compose `.env` on first boot (Web UI values override after save):

```bash
BLANK_CLOUD_PROJECT=/home/you/your-app
# Optional bootstrap — prefer Web UI after first launch
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

| Provider | Setting in UI |
|----------|----------------|
| OpenAI | OpenAI API key |
| Anthropic | Anthropic API key |
| Gemini | Google Gemini API key |
| Groq | Groq API key |
| OpenRouter | OpenRouter API key |
| NVIDIA NIM | NIM API key + base URL ([NVIDIA Integrate](https://integrate.api.nvidia.com/v1) or self-hosted NIM) |
| Custom | Base URL + API key |

Programmatic settings (keys omitted unless you PATCH new values):

```bash
curl -s http://localhost:8787/settings | jq
curl -s -X PATCH http://localhost:8787/settings \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","model":"claude-sonnet-4-20250514","apiKey":"sk-..."}' | jq
```

## Agent workflow

1. **POST /tasks** with a natural-language task.
2. The agent lists and reads files under `/workspace`, may run **run_shell** commands in the project (like Cursor’s terminal — `npm test`, `git status`, `rm` paths inside the repo), then calls **propose_changes** with full file contents and optional shell commands to run on **Accept**.
3. The task moves to **awaiting_approval**. Stream logs on **GET /tasks/:id/stream** (SSE).
4. **POST /tasks/:id/approve** writes files, runs approved commands in the container, and streams stdout/stderr.
5. If a command fails, the agent inspects again and proposes a fix (back to step 3).
6. **POST /tasks/:id/undo** reverts the last approved file write batch.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web UI |
| `GET` | `/health` | Liveness and workspace path |
| `GET` | `/auth/me` | OAuth enabled, signed-in user, per-user repo snapshot |
| `GET` | `/auth/github/login` | Redirect to GitHub OAuth (needs client id + secret) |
| `GET` | `/auth/github/callback` | OAuth callback (sets session cookie) |
| `POST` | `/auth/logout` | Clear session |
| `GET` | `/repo` | Workspace mode, git status, configured remote |
| `PATCH` | `/repo` | Save remote URL, branch, token, push-on-approve |
| `GET` | `/repo/github/repos` | List GitHub repos for connected token (`?q=` search) |
| `POST` | `/repo/github/select` | Pick `fullName`, clone/sync workspace |
| `POST` | `/repo/github/link` | Connect token + return user and repo list |
| `POST` | `/repo/github/device/start` | Start GitHub device OAuth (needs `GITHUB_OAUTH_CLIENT_ID`) |
| `POST` | `/repo/github/device/poll` | Poll device flow for access token |
| `POST` | `/repo/sync` | Clone or pull into the active workspace |
| `POST` | `/repo/push` | Commit all changes and push (manual) |
| `GET` | `/settings` | Active provider/model and which providers have keys configured |
| `PATCH` | `/settings` | Change `provider`, `model`, `customBaseUrl`, or API keys |
| `GET` | `/settings/nim/models` | List model ids from saved NIM key + base URL |
| `POST` | `/settings/test` | Minimal chat completion test for active provider |
| `GET` | `/tasks` | List recent agent runs |
| `POST` | `/tasks` | Body: `{ "prompt": "..." }` → `{ id, status, stream }` |
| `GET` | `/tasks/:id` | Run status, chat messages, pending proposal (with diffs) |
| `GET` | `/tasks/:id/events` | Full event log for the run |
| `POST` | `/tasks/:id/message` | Follow-up message on the same run |
| `POST` | `/tasks/:id/reject` | Reject pending proposal (optional `{ "feedback": "..." }`) |
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

## Troubleshooting

### NVIDIA NIM: HTTP 410 Gone

If chat fails with **410 Gone** while **`GET /settings/nim/models`** still works, NVIDIA’s hosted integrate API is rejecting chat for your account (not necessarily a wrong model id). Common fixes:

1. Ask NVIDIA to enable **Public API Endpoints** for your build.nvidia.com organization — email [help@build.nvidia.com](mailto:help@build.nvidia.com) with your login email and the first characters of your API key.
2. Use **self-hosted NIM** on your LAN and set the base URL to `http://HOST:8000/v1` (OpenAI-compatible).
3. In the Web UI: **Save settings**, **Load NIM models**, pick a listed model, then **Test connection** before starting an agent run.

```bash
curl -s -X POST http://localhost:8787/settings/test
curl -s http://localhost:8787/settings/nim/models | jq
```

### GitHub clone: “Repository not found”

GitHub often returns this when the repo **does not exist**, your **token cannot access** it (private repo / wrong account), or the token was **revoked**. It is not always a wrong URL.

1. Open `https://github.com/OWNER/REPO` in a browser while logged in as the same user you use in blank-cloud.
2. **OAuth:** Sign out → **Sign in with GitHub** again, then re-select the repo.
3. **PAT:** Use a classic token with **`repo`** scope, or a fine-grained token with **Contents: Read** (and Write if you push) on that repository.
4. Remove a stale **`GITHUB_TOKEN`** from `.env` if it overrides the PAT you set in the UI.
5. If a token appeared in an error or chat message, **revoke it** at [GitHub token settings](https://github.com/settings/tokens) and connect again.

Errors from git no longer echo your token in API responses.

### Agent run “not found” after restart

Tasks live in memory until the container restarts. Start a new run with **+** in the sidebar.

## Development (without Docker)

```bash
npm install
WORKSPACE=./project npm run dev
```

## Security notes

- The agent runs shell commands inside the container on the mounted project: **immediately** via `run_shell` during a task, and **after you Accept** when attached to a proposal. Set `BLANK_CLOUD_AGENT_SHELL=0` in `.env` to disable live shell. Obvious host-wide destructive patterns (e.g. `rm -rf /`) are blocked.
- Mount only repositories you trust. Path operations are constrained to `/workspace`.
- Expose port `8787` only on trusted networks; there is no built-in auth.

## License

MIT
