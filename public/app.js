const $ = (id) => document.getElementById(id);

const EVENT_TYPES = [
  "message",
  "log",
  "tool",
  "proposal",
  "awaiting_approval",
  "rejected",
  "command_stdout",
  "command_stderr",
  "command_exit",
  "applied",
  "undone",
  "status",
  "error",
  "done",
  "stream_end",
];

const STATUS_LABEL = {
  idle: "Ready",
  running: "Working",
  executing: "Applying",
  awaiting_approval: "Review changes",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const state = {
  taskId: null,
  status: "idle",
  eventSource: null,
  pollTimer: null,
  seenEventIds: new Set(),
  terminalBody: null,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    let msg = "";
    if (body && typeof body.error === "string") {
      msg = body.error;
    } else if (body && body.error) {
      msg = JSON.stringify(body.error);
    } else if (typeof body === "string" && body.trim()) {
      msg = body.trim();
    } else {
      msg = res.statusText || `HTTP ${res.status}`;
    }

    if (res.status === 404 && path.includes("/tasks/")) {
      throw new Error(
        "This agent run is no longer on the server (it was lost after a container restart). Start a new agent with +.",
      );
    }
    if (res.status === 410 || msg.toLowerCase() === "gone") {
      const detailed =
        body && typeof body.error === "string" && body.error.trim().length > 0
          ? body.error.trim()
          : null;
      const provider = settingsSnapshot?.provider;
      const nim410 =
        provider === "nim"
          ? "NVIDIA NIM HTTP 410 — usually missing Public API Endpoints on build.nvidia.com (not wrong model). Email help@build.nvidia.com or use self-hosted NIM. Settings → Save → Test connection."
          : null;
      throw new Error(detailed || nim410 || msg);
    }
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  return body;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function setStatus(status) {
  state.status = status;
  $("status-dot").className = `status-dot ${status}`;
  $("status-label").textContent = STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function updateEmptyState() {
  const empty = $("empty-state");
  if (!empty) return;
  const hasContent = $("chat-thread").querySelector(".turn, .tool-row, .terminal-block, .system-note");
  empty.hidden = Boolean(hasContent);
}

function scrollThread() {
  const el = $("chat-thread");
  el.scrollTop = el.scrollHeight;
}

function addTurn(role, text) {
  $("empty-state").hidden = true;
  const wrap = document.createElement("div");
  wrap.className = `turn turn-${role}`;
  wrap.innerHTML = `<div class="turn-label">${role === "user" ? "You" : "Agent"}</div><div class="turn-body"></div>`;
  wrap.querySelector(".turn-body").textContent = text;
  $("chat-thread").appendChild(wrap);
  scrollThread();
}

function addToolRow(text) {
  $("empty-state").hidden = true;
  const row = document.createElement("div");
  row.className = "tool-row";
  row.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="1.2" opacity=".5"/></svg><span></span>`;
  row.querySelector("span").textContent = text;
  $("chat-thread").appendChild(row);
  scrollThread();
}

function addSystemNote(text) {
  const el = document.createElement("div");
  el.className = "system-note";
  el.textContent = text;
  $("chat-thread").appendChild(el);
  scrollThread();
}

function ensureTerminal() {
  if (state.terminalBody) return state.terminalBody;
  $("empty-state").hidden = true;
  const block = document.createElement("div");
  block.className = "terminal-block";
  block.innerHTML = `<div class="terminal-head">Terminal</div><pre class="terminal-body"></pre>`;
  $("chat-thread").appendChild(block);
  state.terminalBody = block.querySelector(".terminal-body");
  return state.terminalBody;
}

function appendTerminal(line) {
  ensureTerminal().textContent += `${line}\n`;
  scrollThread();
}

const EMPTY_HTML = `<p class="empty-title">What should we build?</p>
<p class="empty-body">Connect a git remote in the sidebar (or mount a folder via docker-compose), then describe the task. Approve changes before they land in the repo.</p>
<ul class="empty-hints"><li>Fix a failing test</li><li>Add an API endpoint</li><li>Refactor a module</li></ul>`;

function clearChat() {
  $("chat-thread").innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.id = "empty-state";
  empty.innerHTML = EMPTY_HTML;
  $("chat-thread").appendChild(empty);
  state.terminalBody = null;
  state.seenEventIds.clear();
}

function ingestEvent(ev) {
  if (state.seenEventIds.has(ev.id)) return;
  state.seenEventIds.add(ev.id);

  const type = ev.type;
  const msg = ev.message ?? "";
  const role = ev.data?.role;

  if (type === "message") {
    addTurn(role === "user" ? "user" : "agent", msg);
    return;
  }
  if (type === "log") {
    addTurn("agent", msg);
    return;
  }
  if (type === "tool") {
    addToolRow(msg);
    return;
  }
  if (type === "command_stdout" || type === "command_stderr") {
    appendTerminal(msg);
    return;
  }
  if (type === "command_exit") {
    appendTerminal(`exit ${msg}`);
    return;
  }
  if (type === "error") {
    addSystemNote(msg.startsWith("Error:") ? msg : `Error: ${msg}`);
    setStatus("failed");
    return;
  }
  if (type === "done") {
    addSystemNote(msg);
    return;
  }
  if (type === "rejected") {
    addSystemNote(msg ? `Rejected — ${msg}` : "Changes rejected");
    return;
  }
  if (type === "status" && ev.data?.status) {
    setStatus(ev.data.status);
  }
  if (type === "awaiting_approval" || type === "proposal") {
    void refreshTask();
  }
  if (type === "stream_end") {
    void refreshTask();
    void loadRuns();
  }
}

function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function connectStream(taskId) {
  closeStream();
  const es = new EventSource(`/tasks/${taskId}/stream`);
  state.eventSource = es;
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e) => {
      try {
        ingestEvent(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    });
  }
}

function simpleDiff(oldText, newText) {
  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");
  const out = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (n !== undefined) out.push({ t: "ctx", l: ` ${n}` });
    } else {
      if (o !== undefined) out.push({ t: "del", l: `-${o}` });
      if (n !== undefined) out.push({ t: "add", l: `+${n}` });
    }
  }
  return out;
}

function renderChanges(task) {
  const panel = $("changes-panel");
  const p = task.pendingProposal;
  if (!p || task.status !== "awaiting_approval") {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("change-summary").textContent = p.summary;
  const filesEl = $("change-files");
  filesEl.innerHTML = "";
  for (const f of p.files) {
    const card = document.createElement("div");
    card.className = "file-card";
    const badge = f.isNew ? `<span class="file-badge">new</span>` : "";
    card.innerHTML = `<header><span>${escapeHtml(f.path)}</span>${badge}</header>`;
    const pre = document.createElement("pre");
    pre.className = "diff";
    for (const line of simpleDiff(f.previousContent, f.content)) {
      const span = document.createElement("span");
      span.className = line.t;
      span.textContent = `${line.l}\n`;
      pre.appendChild(span);
    }
    card.appendChild(pre);
    filesEl.appendChild(card);
  }
  const cmdEl = $("change-commands");
  if (p.commands?.length) {
    cmdEl.innerHTML = "<span>Runs after accept</span><ul></ul>";
    const ul = cmdEl.querySelector("ul");
    for (const c of p.commands) {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    }
  } else {
    cmdEl.innerHTML = "";
  }
}

async function refreshTask() {
  if (!state.taskId) return;
  try {
    const task = await api(`/tasks/${state.taskId}`);
    setStatus(task.status);
    $("run-title").textContent = task.title || "Agent";
    $("run-meta").textContent =
      task.status === "failed" && task.lastError
        ? task.lastError
        : task.id;
    $("run-meta").className = task.status === "failed" && task.lastError ? "run-id error-text" : "run-id";
    $("approve").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
    $("reject").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
    $("undo").disabled = !task.canUndo;
    renderChanges(task);
    if (task.status === "running" || task.status === "executing") startPoll();
    else stopPoll();
  } catch (e) {
    stopPoll();
    setStatus("failed");
    $("run-meta").textContent = e.message;
    addSystemNote(e.message);
  }
}

function startPoll() {
  stopPoll();
  state.pollTimer = setInterval(() => void refreshTask(), 2000);
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadRuns() {
  const data = await api("/tasks");
  const list = $("run-list");
  list.innerHTML = "";
  if (!data.tasks.length) {
    list.innerHTML = `<li class="system-note" style="text-align:left;padding:8px">No runs yet</li>`;
    return;
  }
  for (const run of data.tasks) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `run-item${run.id === state.taskId ? " active" : ""}`;
    btn.innerHTML = `<div class="run-item-title">${escapeHtml(run.title)}</div><div class="run-item-meta">${escapeHtml((STATUS_LABEL[run.status] ?? run.status).toLowerCase())}</div>`;
    btn.addEventListener("click", () => void openRun(run.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function openRun(taskId) {
  state.taskId = taskId;
  clearChat();
  closeStream();
  const [task, evData] = await Promise.all([
    api(`/tasks/${taskId}`),
    api(`/tasks/${taskId}/events`),
  ]);
  $("run-title").textContent = task.title;
  $("run-meta").textContent = task.id;
  setStatus(task.status);
  for (const ev of evData.events) ingestEvent(ev);
  renderChanges(task);
  await loadRuns();
  if (["running", "executing", "awaiting_approval"].includes(task.status)) {
    connectStream(taskId);
  }
  if (task.status === "running" || task.status === "executing") startPoll();
}

function newRun() {
  state.taskId = null;
  clearChat();
  closeStream();
  stopPoll();
  setStatus("idle");
  $("run-title").textContent = "New agent";
  $("run-meta").textContent = "";
  $("changes-panel").hidden = true;
  $("composer-input").focus();
  void loadRuns();
}

function resizeComposer() {
  const ta = $("composer-input");
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
}

async function sendMessage() {
  const text = $("composer-input").value.trim();
  if (!text) return;
  $("send-btn").disabled = true;
  try {
    if (!state.taskId) {
      const task = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({ prompt: text }),
      });
      state.taskId = task.id;
      $("composer-input").value = "";
      resizeComposer();
      setStatus(task.status);
      connectStream(task.id);
      startPoll();
      await loadRuns();
      await refreshTask();
    } else {
      if (state.status === "awaiting_approval") throw new Error("Accept or reject changes first");
      if (state.status === "running" || state.status === "executing") {
        throw new Error("Agent is still working");
      }
      $("composer-input").value = "";
      resizeComposer();
      await api(`/tasks/${state.taskId}/message`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setStatus("running");
      connectStream(state.taskId);
      startPoll();
    }
  } catch (e) {
    addSystemNote(e.message);
  } finally {
    $("send-btn").disabled = false;
  }
}

async function approve() {
  if (!state.taskId) return;
  $("approve").disabled = true;
  try {
    addSystemNote("Accepted — applying to workspace");
    state.terminalBody = null;
    await api(`/tasks/${state.taskId}/approve`, { method: "POST", body: "{}" });
    connectStream(state.taskId);
    await refreshTask();
  } catch (e) {
    addSystemNote(e.message);
  }
}

async function reject() {
  if (!state.taskId) return;
  const feedback = window.prompt("Feedback for the agent (optional):") ?? "";
  try {
    await api(`/tasks/${state.taskId}/reject`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
    connectStream(state.taskId);
    await refreshTask();
  } catch (e) {
    addSystemNote(e.message);
  }
}

async function undoApply() {
  if (!state.taskId) return;
  try {
    const res = await api(`/tasks/${state.taskId}/undo`, { method: "POST", body: "{}" });
    addSystemNote(`Reverted ${(res.files || []).join(", ") || "last apply"}`);
    await refreshTask();
  } catch (e) {
    addSystemNote(e.message);
  }
}

async function loadHealth() {
  try {
    const data = await api("/health");
    const el = $("workspace");
    el.textContent = data.workspace;
    el.title = data.workspace;
  } catch {
    $("workspace").textContent = "Unavailable";
  }
}

let repoSnapshot = null;
let repoSearchTimer = null;
let selectedRepoFullName = null;

function renderRepoList(repos, activeFullName) {
  const list = $("repo-list");
  list.innerHTML = "";
  if (!repos?.length) {
    list.innerHTML = `<li class="fine-print" style="padding:8px">No repositories found.</li>`;
    return;
  }
  for (const r of repos) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    if (r.full_name === activeFullName) btn.classList.add("active");
    btn.innerHTML = `<div class="repo-item-name">${escapeHtml(r.full_name)}${r.private ? " · private" : ""}</div><div class="repo-item-meta">${escapeHtml(r.default_branch ?? "main")}${r.description ? ` · ${escapeHtml(r.description.slice(0, 60))}` : ""}</div>`;
    btn.addEventListener("click", () => void selectGitHubRepo(r.full_name));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function renderRepoStatus(data) {
  repoSnapshot = data;
  const el = $("repo-status");
  if (!data) {
    el.textContent = "Repository status unavailable.";
    el.className = "fine-print repo-status warn";
    return;
  }
  const selected = data.configured?.githubRepoFullName;
  selectedRepoFullName = selected || selectedRepoFullName;
  let line = data.ready ? "Ready — start an agent run." : "Pick a repository below.";
  if (selected) {
    line = `${data.ready ? "Ready" : "Selected"}: ${selected} (${data.configured?.branch ?? "main"})`;
  }
  if (data.git?.isRepo && !data.git.clean) {
    line += ` · ${data.git.changedFiles} local change(s)`;
  }
  el.textContent = line;
  el.className = `fine-print repo-status ${data.ready ? "ok" : "warn"}`;
  $("workspace").textContent = data.workspace;
  $("workspace").title = data.workspace;
}

async function loadRepo() {
  try {
    const data = await api("/repo");
    const auth = data.auth ?? {};
    $("repo-signin-github").hidden = !auth.oauthEnabled || auth.signedIn;
    $("repo-logout").hidden = !auth.signedIn;
    $("repo-token-wrap").hidden = auth.oauthEnabled && auth.signedIn;
    $("repo-connect-github").hidden = auth.oauthEnabled;
    $("repo-url").value = data.configured?.remoteUrl || "";
    $("repo-branch").value = data.configured?.branch || "main";
    $("repo-push").checked = Boolean(data.configured?.pushOnApprove);
    $("repo-bot-name").value = data.configured?.gitAuthorName || "";
    $("repo-bot-email").value = data.configured?.gitAuthorEmail || "";
    $("repo-token").value = "";
    $("repo-device-github").hidden = !data.githubDeviceFlowAvailable;

    const gh = data.github;
    const linkEl = $("repo-github-link");
    if (gh?.login) {
      linkEl.innerHTML = auth.oauthEnabled
        ? `Signed in as <a href="${escapeHtml(gh.html_url)}" target="_blank" rel="noopener">@${escapeHtml(gh.login)}</a> — pick a repo:`
        : `Connected as <a href="${escapeHtml(gh.html_url)}" target="_blank" rel="noopener">@${escapeHtml(gh.login)}</a> — pick a repo:`;
      linkEl.className = "fine-print repo-status ok";
      $("repo-picker").hidden = false;
      await refreshGitHubRepoList($("repo-search").value.trim());
    } else if (auth.oauthEnabled) {
      linkEl.textContent = "Sign in with GitHub, then pick a repository.";
      linkEl.className = "fine-print";
      $("repo-picker").hidden = true;
    } else {
      linkEl.textContent =
        "Paste a GitHub personal access token (repo scope), then Connect (PAT).";
      linkEl.className = "fine-print";
      $("repo-picker").hidden = true;
    }
    renderRepoStatus(data);
  } catch (e) {
    renderRepoStatus(null);
    $("repo-status").textContent = e.message;
  }
}

async function refreshGitHubRepoList(q) {
  if (!repoSnapshot?.github) return;
  try {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const data = await api(`/repo/github/repos${qs}`);
    renderRepoList(data.repos, repoSnapshot?.configured?.githubRepoFullName);
  } catch (e) {
    addSystemNote(e.message);
  }
}

async function logoutGitHub() {
  await api("/auth/logout", { method: "POST", body: "{}" });
  await loadRepo();
  addSystemNote("Signed out of GitHub");
}

async function connectGitHub() {
  $("repo-connect-github").disabled = true;
  try {
    const token = $("repo-token").value.trim();
    if (!token) {
      throw new Error("Paste a GitHub token first (Settings → Developer settings → PAT).");
    }
    const res = await api("/repo/github/link", {
      method: "POST",
      body: JSON.stringify({ gitToken: token }),
    });
    if (res.github?.commitName) $("repo-bot-name").value = res.github.commitName;
    if (res.github?.commitEmail) $("repo-bot-email").value = res.github.commitEmail;
    $("repo-picker").hidden = false;
    renderRepoList(res.repos, null);
    await loadRepo();
    addSystemNote(`GitHub connected as @${res.github.login}. Select a repository.`);
  } catch (e) {
    addSystemNote(e.message);
  } finally {
    $("repo-connect-github").disabled = false;
  }
}

async function selectGitHubRepo(fullName) {
  try {
    $("repo-status").textContent = `Cloning ${fullName}…`;
    const res = await api("/repo/github/select", {
      method: "POST",
      body: JSON.stringify({ fullName, sync: true }),
    });
    selectedRepoFullName = fullName;
    await loadRepo();
    addSystemNote(`Workspace ready: ${fullName} (${res.selected?.branch})`);
  } catch (e) {
    addSystemNote(e.message);
    await loadRepo();
  }
}

async function startGitHubDeviceSignIn() {
  $("repo-device-github").disabled = true;
  try {
    const start = await api("/repo/github/device/start", { method: "POST", body: "{}" });
    addSystemNote(`Open ${start.verification_uri} and enter code ${start.user_code}`);
    window.open(start.verification_uri, "_blank", "noopener");
    const intervalMs = (start.interval || 5) * 1000;
    let pending = true;
    while (pending) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const poll = await api("/repo/github/device/poll", {
        method: "POST",
        body: JSON.stringify({ deviceCode: start.device_code }),
      });
      if (poll.status === "pending" || poll.status === "slow_down") continue;
      if (poll.status === "ok") {
        pending = false;
        $("repo-picker").hidden = false;
        renderRepoList(poll.repos, null);
        await loadRepo();
        addSystemNote(`Signed in as @${poll.github.login}. Select a repository.`);
        break;
      }
    }
  } catch (e) {
    addSystemNote(e.message);
  } finally {
    $("repo-device-github").disabled = false;
  }
}

async function saveRepo() {
  const payload = {
    remoteUrl: $("repo-url").value.trim(),
    branch: $("repo-branch").value.trim() || "main",
    pushOnApprove: $("repo-push").checked,
    gitAuthorName: $("repo-bot-name").value.trim(),
    gitAuthorEmail: $("repo-bot-email").value.trim(),
  };
  const token = $("repo-token").value.trim();
  if (token) payload.gitToken = token;
  await api("/repo", { method: "PATCH", body: JSON.stringify(payload) });
  await loadRepo();
}

async function syncRepo() {
  $("repo-sync").disabled = true;
  try {
    await saveRepo();
    const res = await api("/repo/sync", { method: "POST", body: "{}" });
    await loadRepo();
    addSystemNote(`Repository ${res.action}: ${res.branch}`);
  } catch (e) {
    addSystemNote(e.message);
    await loadRepo();
  } finally {
    $("repo-sync").disabled = false;
  }
}

const API_KEY_LABELS = {
  openai: "OpenAI API key",
  anthropic: "Anthropic API key",
  gemini: "Google Gemini API key",
  groq: "Groq API key",
  openrouter: "OpenRouter API key",
  nim: "NVIDIA NIM API key",
  custom: "Custom OpenAI-compatible API key",
};

/** Last GET /settings payload — used when switching provider without round-trip reset. */
let settingsSnapshot = null;

function setSettingsStatus(text, kind) {
  const el = $("settings-status");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("ok", "err");
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function syncProviderFields() {
  const provider = $("provider").value;
  const needsBase = provider === "custom" || provider === "nim";
  $("custom-url-wrap").hidden = !needsBase;
  $("nim-help").hidden = provider !== "nim";
  $("load-nim-models").hidden = provider !== "nim";
  $("base-url-label").textContent =
    provider === "nim" ? "NIM base URL (OpenAI-compatible)" : "Base URL";
  $("custom-base-url").placeholder =
    provider === "nim"
      ? "https://integrate.api.nvidia.com/v1"
      : "https://api.example.com/v1";
  $("api-key-label").textContent = API_KEY_LABELS[provider] ?? "API key";
}

function refreshKeyHint() {
  const provider = $("provider").value;
  const masked = settingsSnapshot?.keys?.[providerKeyField(provider)];
  $("key-hint").textContent = masked
    ? `Saved: ${masked} (leave blank to keep)`
    : "No key saved for this provider yet.";
}

function onProviderChange() {
  const provider = $("provider").value;
  const meta = settingsSnapshot?.providers?.find((p) => p.id === provider);
  if (meta?.defaultModel) {
    $("model").value = meta.defaultModel;
  }
  syncProviderFields();
  refreshKeyHint();
}

async function loadSettings() {
  const data = await api("/settings");
  settingsSnapshot = data;
  const select = $("provider");
  select.innerHTML = "";
  for (const p of data.providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.configured ? p.id : `${p.id} · needs key`;
    if (p.id === data.provider) opt.selected = true;
    select.appendChild(opt);
  }
  $("model").value = data.model || "";
  $("custom-base-url").value = data.customBaseUrl || "";
  syncProviderFields();
  refreshKeyHint();
  $("api-key").value = "";
  for (const input of document.querySelectorAll("[data-key]")) {
    input.value = "";
  }
}

function providerKeyField(provider) {
  if (provider === "custom") return "customApiKey";
  return provider;
}

async function saveSettings() {
  const provider = $("provider").value;
  let model = $("model").value.trim();
  if (!model) {
    model = settingsSnapshot?.providers?.find((p) => p.id === provider)?.defaultModel ?? "";
  }
  const payload = {
    provider,
    model,
    customBaseUrl: $("custom-base-url").value.trim(),
  };
  const apiKey = $("api-key").value.trim();
  if (apiKey) payload.apiKey = apiKey;

  const keys = {};
  for (const input of document.querySelectorAll("[data-key]")) {
    const v = input.value.trim();
    if (v) keys[input.dataset.key] = v;
  }
  if (Object.keys(keys).length) payload.keys = keys;

  await api("/settings", { method: "PATCH", body: JSON.stringify(payload) });
  await loadSettings();
  setSettingsStatus("Settings saved.", "ok");
  addSystemNote(`Active provider: ${settingsSnapshot?.provider ?? provider}`);
}

async function testSettingsConnection() {
  setSettingsStatus("Testing LLM connection…", null);
  try {
    const res = await api("/settings/test", { method: "POST", body: "{}" });
    setSettingsStatus(
      `Connection OK (${res.provider} / ${res.model}): ${res.reply || "OK"}`,
      "ok",
    );
  } catch (e) {
    setSettingsStatus(e.message, "err");
  }
}

async function loadNimModels() {
  setSettingsStatus("Loading models from NIM…", null);
  try {
    const res = await api("/settings/nim/models");
    const models = res.models || [];
    if (!models.length) {
      setSettingsStatus(`No models returned from ${res.base}.`, "err");
      return;
    }
    const current = $("model").value.trim();
    if (!current || !models.includes(current)) {
      $("model").value = models[0];
    }
    const preview =
      models.length <= 8
        ? models.join(", ")
        : `${models.slice(0, 6).join(", ")} … (+${models.length - 6} more)`;
    setSettingsStatus(
      `Listed ${models.length} model(s) from ${res.base}. Pick one in Model, then Save and Test connection.\n${preview}`,
      "ok",
    );
  } catch (e) {
    setSettingsStatus(e.message, "err");
  }
}

$("new-run").addEventListener("click", newRun);
$("send-btn").addEventListener("click", () => void sendMessage());
$("approve").addEventListener("click", () => void approve());
$("reject").addEventListener("click", () => void reject());
$("undo").addEventListener("click", () => void undoApply());
$("save-settings").addEventListener("click", () => void saveSettings());
$("test-settings").addEventListener("click", () => void testSettingsConnection());
$("load-nim-models").addEventListener("click", () => void loadNimModels());
$("repo-save").addEventListener("click", () => void saveRepo());
$("repo-sync").addEventListener("click", () => void syncRepo());
$("repo-connect-github").addEventListener("click", () => void connectGitHub());
$("repo-logout").addEventListener("click", () => void logoutGitHub());
$("repo-device-github").addEventListener("click", () => void startGitHubDeviceSignIn());
$("repo-search").addEventListener("input", () => {
  clearTimeout(repoSearchTimer);
  repoSearchTimer = setTimeout(() => void refreshGitHubRepoList($("repo-search").value.trim()), 250);
});
$("provider").addEventListener("change", () => {
  onProviderChange();
  setSettingsStatus("", null);
});

$("settings-toggle").addEventListener("click", () => {
  const pop = $("settings-popover");
  const open = pop.hidden;
  if (open) void loadSettings();
  pop.hidden = !open;
  $("settings-toggle").setAttribute("aria-expanded", String(open));
});

$("composer-input").addEventListener("input", resizeComposer);
$("composer-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

document.addEventListener("click", (e) => {
  const pop = $("settings-popover");
  if (pop.hidden) return;
  if (e.target.closest("#settings-popover") || e.target.closest("#settings-toggle")) return;
  pop.hidden = true;
  $("settings-toggle").setAttribute("aria-expanded", "false");
});

void loadHealth();
void loadRepo();
void loadSettings();
void loadRuns();
setStatus("idle");
