const $ = (id) => document.getElementById(id);

const EVENT_TYPES = [
  "message",
  "message_delta",
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
  activeStream: null,
};

const md = () => window.blankCloudMarkdown;

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
  const pill = $("status-label");
  if (pill) {
    pill.className = `status-pill status-${status}`;
    pill.textContent = STATUS_LABEL[status] ?? status.replace(/_/g, " ");
  }
}

function setReviewOpen(open) {
  $("app-root")?.classList.toggle("review-open", Boolean(open));
}

function openModal(backdropId) {
  const el = $(backdropId);
  if (el) el.hidden = false;
}

function closeModal(backdropId) {
  const el = $(backdropId);
  if (el) el.hidden = true;
}

function bindModal(backdropId, closeId) {
  const backdrop = $(backdropId);
  const closeBtn = $(closeId);
  if (!backdrop) return;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal(backdropId);
  });
  backdrop.querySelector(".modal")?.addEventListener("click", (e) => e.stopPropagation());
  closeBtn?.addEventListener("click", () => closeModal(backdropId));
}

function updateSidebarModel() {
  const el = $("sidebar-model");
  if (!el || !settingsSnapshot) return;
  const provider = settingsSnapshot.provider || "";
  const model = (settingsSnapshot.model || "").trim();
  const configured = settingsSnapshot.providers?.find((p) => p.id === provider)?.configured;
  if (!configured) {
    el.textContent = provider ? `${provider} · needs key` : "Not configured";
    el.classList.add("warn");
    return;
  }
  el.classList.remove("warn");
  if (!model) {
    el.textContent = provider ? `${provider} · no model` : "Not configured";
    return;
  }
  el.textContent = provider ? `${provider} · ${model}` : model;
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

function setTurnBody(bodyEl, text, streaming) {
  bodyEl.classList.add("md-body");
  const render = md()?.renderMarkdown;
  if (render) {
    bodyEl.innerHTML = render(text, streaming);
  } else {
    bodyEl.textContent = text;
  }
}

function clearActiveStream() {
  state.activeStream = null;
}

function turnInnerHtml(role) {
  const isUser = role === "user";
  const label = isUser ? "You" : "Agent";
  const roleClass = isUser ? "turn-user" : "turn-agent";
  return `<div class="turn-row ${roleClass}">
    <div class="turn-rail"><span class="turn-role">${label}</span></div>
    <div class="turn-bubble ${isUser ? "user-bubble" : "agent-bubble"}"><div class="turn-body"></div></div>
  </div>`;
}

function upsertStreamingTurn(role, streamId, text) {
  $("empty-state").hidden = true;
  const roleKey = role === "user" ? "user" : "agent";
  if (state.activeStream?.streamId === streamId && state.activeStream.wrap) {
    setTurnBody(state.activeStream.body, text, true);
    scrollThread();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = `turn turn-${roleKey}`;
  wrap.innerHTML = turnInnerHtml(roleKey);
  const body = wrap.querySelector(".turn-body");
  body.dataset.streamId = streamId;
  setTurnBody(body, text, true);
  $("chat-thread").appendChild(wrap);
  state.activeStream = { streamId, wrap, body, role: roleKey };
  scrollThread();
}

function addTurn(role, text) {
  clearActiveStream();
  $("empty-state").hidden = true;
  const roleKey = role === "user" ? "user" : "agent";
  const wrap = document.createElement("div");
  wrap.className = `turn turn-${roleKey}`;
  wrap.innerHTML = turnInnerHtml(roleKey);
  const body = wrap.querySelector(".turn-body");
  setTurnBody(body, text, false);
  $("chat-thread").appendChild(wrap);
  scrollThread();
}

const TOOL_CATEGORY = {
  list_directory: { label: "Explore", className: "tool-cat-explore" },
  read_file: { label: "Explore", className: "tool-cat-explore" },
  propose_changes: { label: "Changes", className: "tool-cat-changes" },
  run_shell: { label: "Terminal", className: "tool-cat-shell" },
};

function toolCategoryMeta(data) {
  const id = data?.tool;
  return TOOL_CATEGORY[id] ?? { label: "Tool", className: "tool-cat-other" };
}

function humanizeToolMessage(msg, data) {
  const text = String(msg ?? "");
  if (text === "Listed ." || data?.path === ".") {
    return "Listed files in project root";
  }
  if (/^Listed \.$/.test(text)) {
    return "Listed files in project root";
  }
  return text;
}

function addToolRow(text, data) {
  $("empty-state").hidden = true;
  const cat = toolCategoryMeta(data);
  const row = document.createElement("div");
  row.className = `tool-row ${cat.className}`;
  row.innerHTML = `<span class="tool-cat-badge">${escapeHtml(cat.label)}</span><span class="tool-cat-msg"></span>`;
  row.querySelector(".tool-cat-msg").textContent = humanizeToolMessage(text, data);
  $("chat-thread").appendChild(row);
  scrollThread();
}

function showRepoSyncRecovery(message) {
  const m = String(message ?? "");
  const gitish =
    m.includes("origin/main") ||
    m.includes("HTTP 400") ||
    m.includes("checkout -B") ||
    m.includes("missing after fetch");
  addSystemNote(m);
  if (!gitish) return;
  addSystemNote(
    "NAS: curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/scripts/nas-fix.sh | bash",
  );
  addSystemNote(
    "Then hard-refresh the browser and pick the repo again. If needed, clear the workspace git metadata (replace USER with your GitHub login): docker compose exec blank-cloud rm -rf /app/data/workspaces/USER/.git",
  );
}

function addSystemNote(text) {
  const el = document.createElement("div");
  el.className = "system-note";
  el.textContent = text;
  $("chat-thread").appendChild(el);
  updateEmptyState();
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

function clearChat() {
  const thread = $("chat-thread");
  for (const child of [...thread.children]) {
    if (child.id !== "empty-state") child.remove();
  }
  const empty = $("empty-state");
  if (empty) empty.hidden = false;
  state.terminalBody = null;
  state.seenEventIds.clear();
  clearActiveStream();
  updateEmptyState();
}

function wireEmptyHints() {
  const root = $("empty-hints");
  if (!root || root.dataset.wired) return;
  root.dataset.wired = "1";
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-prompt]");
    if (!btn) return;
    $("composer-input").value = btn.dataset.prompt || "";
    resizeComposer();
    $("composer-input").focus();
  });
}

function chatHistoryGroup(updatedAt) {
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startToday) return "Today";
  if (d >= startYesterday) return "Yesterday";
  return "Earlier";
}

function ingestEvent(ev) {
  if (state.seenEventIds.has(ev.id)) return;
  state.seenEventIds.add(ev.id);

  const type = ev.type;
  const msg = ev.message ?? "";
  const role = ev.data?.role;

  if (type === "message_delta") {
    const streamId = ev.data?.streamId;
    if (!streamId) return;
    upsertStreamingTurn(role === "user" ? "user" : "agent", streamId, msg);
    return;
  }
  if (type === "message") {
    const roleKey = role === "user" ? "user" : "agent";
    if (
      state.activeStream &&
      roleKey === "agent" &&
      ev.data?.streamId &&
      state.activeStream.streamId === ev.data.streamId
    ) {
      setTurnBody(state.activeStream.body, msg, false);
      clearActiveStream();
      return;
    }
    if (state.activeStream && roleKey === "agent") {
      setTurnBody(state.activeStream.body, msg, false);
      clearActiveStream();
      return;
    }
    addTurn(roleKey, msg);
    return;
  }
  if (type === "log") {
    addTurn("agent", msg);
    return;
  }
  if (type === "tool") {
    addToolRow(msg, ev.data);
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
    if (ev.data?.status) setStatus(ev.data.status);
    else setStatus("completed");
    stopPoll();
    void refreshTask();
    return;
  }
  if (type === "rejected") {
    addSystemNote(msg ? `Rejected — ${msg}` : "Changes rejected");
    return;
  }
  if (type === "status") {
    if (ev.data?.status) {
      setStatus(ev.data.status);
      if (ev.data.status === "running" && msg) {
        $("status-label").textContent = msg;
      }
    }
    return;
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
    setReviewOpen(false);
    return;
  }
  panel.hidden = false;
  setReviewOpen(true);
  $("change-summary").textContent = p.summary;
  const filesEl = $("change-files");
  filesEl.innerHTML = "";
  if (p.files?.length) {
    const label = document.createElement("div");
    label.className = "review-subsection-label";
    label.textContent = `Files (${p.files.length})`;
    filesEl.appendChild(label);
  }
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
    cmdEl.innerHTML = '<div class="review-subsection-label">Commands after accept</div><ul></ul>';
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
    list.innerHTML = `<li class="run-list-empty">No chats yet — start with New Chat</li>`;
    return;
  }
  const order = ["Today", "Yesterday", "Earlier"];
  const buckets = new Map(order.map((g) => [g, []]));
  for (const run of data.tasks) {
    const g = chatHistoryGroup(run.updatedAt);
    buckets.get(g)?.push(run);
  }
  for (const group of order) {
    const runs = buckets.get(group) ?? [];
    if (!runs.length) continue;
    const head = document.createElement("li");
    head.className = "run-list-group-label";
    head.textContent = group;
    list.appendChild(head);
    for (const run of runs) {
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
  $("run-title").textContent = "New Chat";
  $("run-meta").textContent = "";
  $("run-meta").hidden = true;
  $("changes-panel").hidden = true;
  setReviewOpen(false);
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

let updateSnapshot = null;

function renderUpdatePanel(data) {
  updateSnapshot = data;
  const panel = $("update-panel");
  const show = Boolean(data.updateAvailable);
  panel.hidden = !show;
  if (!show) {
    return;
  }
  const applyBtn = $("update-apply");
  applyBtn.disabled = false;
  applyBtn.textContent = data.applyAvailable ? "Update now" : "Update available";
}

/** Check GitHub on every page load; show the button only when an update exists. */
async function loadUpdateStatus() {
  $("update-panel").hidden = true;
  try {
    const data = await api("/update/check");
    renderUpdatePanel(data);
  } catch {
    try {
      renderUpdatePanel(await api("/update/status"));
    } catch {
      $("update-panel").hidden = true;
    }
  }
}

async function applyUpdateNow() {
  if (!updateSnapshot?.updateAvailable) {
    return;
  }
  if (!updateSnapshot.applyAvailable) {
    addSystemNote("Update on the host: cd ~/blank-cloud && bash scripts/update.sh");
    return;
  }
  if (!confirm("Pull latest blank-cloud and restart the container? Active agent runs may be interrupted.")) {
    return;
  }
  $("update-apply").disabled = true;
  try {
    const data = await api("/update/apply", { method: "POST", body: "{}" });
    renderUpdatePanel(data);
    const msg = data.message || data.error || "Update started";
    addSystemNote(msg);
    if (
      typeof msg === "string" &&
      (msg.includes("origin/main") || msg.includes("HTTP 400") || msg.includes("git fetch"))
    ) {
      addSystemNote(
        "Host fix: curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/cursor/ui-polish-d75c/scripts/recover-from-github.sh | bash -s ~/blank-cloud && docker compose up -d --build",
      );
    }
  } catch (e) {
    addSystemNote(e.message);
  } finally {
    $("update-apply").disabled = false;
  }
}

async function loadHealth() {
  try {
    await api("/health");
  } catch {
    /* ignore */
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
    el.hidden = true;
    return;
  }
  const perUser = Boolean(data.oneClickGitHubConnect);
  const connected = perUser
    ? Boolean(data.auth?.signedIn)
    : Boolean(data.github?.login);
  if (!connected) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const selected = data.configured?.githubRepoFullName;
  selectedRepoFullName = selected || selectedRepoFullName;
  let line = data.ready ? "Ready" : "Pick a repository";
  if (selected) {
    line = `${data.ready ? "Ready" : "Selected"}: ${selected}`;
  }
  el.textContent = line;
  el.className = `fine-print repo-status ${data.ready ? "ok" : "warn"}`;
}

async function loadRepo() {
  try {
    const data = await api("/repo");
    const perUser = Boolean(data.oneClickGitHubConnect);
    const connected = perUser
      ? Boolean(data.auth?.signedIn)
      : Boolean(data.github?.login);
    repoSnapshot = data;

    $("repo-connect-github").hidden = connected;
    $("repo-logout").hidden = !connected;

    if (connected) {
      $("repo-picker").hidden = false;
      await refreshGitHubRepoList($("repo-search").value.trim());
    } else {
      $("repo-picker").hidden = true;
      $("repo-list").innerHTML = "";
      $("repo-search").value = "";
    }
    renderRepoStatus(data);
  } catch (e) {
    renderRepoStatus(null);
    addSystemNote(e.message);
  }
}

async function refreshGitHubRepoList(q) {
  if (!repoSnapshot) return;
  const perUser = Boolean(repoSnapshot.oneClickGitHubConnect);
  const ok = perUser
    ? Boolean(repoSnapshot.auth?.signedIn)
    : Boolean(repoSnapshot.github?.login);
  if (!ok) return;
  try {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const data = await api(`/repo/github/repos${qs}`);
    renderRepoList(data.repos, repoSnapshot?.configured?.githubRepoFullName);
  } catch (e) {
    addSystemNote(e.message);
  }
}

async function logoutGitHub() {
  $("repo-logout").disabled = true;
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
    repoSnapshot = null;
    $("repo-list").innerHTML = "";
    $("repo-search").value = "";
    await loadRepo();
    addSystemNote("Signed out of GitHub");
  } catch (e) {
    addSystemNote(e.message);
  } finally {
    $("repo-logout").disabled = false;
  }
}

async function connectGitHub() {
  $("repo-connect-github").disabled = true;
  try {
    if (repoSnapshot?.auth?.oauthEnabled) {
      window.location.href = "/auth/github/login";
      return;
    }
    await startGitHubDeviceSignIn();
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
    showRepoSyncRecovery(e.message);
    await loadRepo();
  }
}

async function startGitHubDeviceSignIn() {
  const panel = $("github-device-panel");
  const codeEl = $("github-device-code");
  const openEl = $("github-device-open");
  try {
    const start = await api("/repo/github/device/start", { method: "POST", body: "{}" });
    const code = start.user_code || "????";
    const uri = start.verification_uri || "https://github.com/login/device";
    panel.hidden = false;
    codeEl.textContent = code;
    openEl.href = uri;
    addSystemNote(`GitHub code: ${code} — use Open GitHub in the sidebar or ${uri}`);
    window.open(uri, "_blank", "noopener");
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
        panel.hidden = true;
        $("repo-picker").hidden = false;
        renderRepoList(poll.repos, null);
        await loadRepo();
        addSystemNote(`Signed in as @${poll.github.login}. Select a repository.`);
        break;
      }
    }
  } catch (e) {
    panel.hidden = true;
    addSystemNote(e.message);
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
  const modelInput = $("model");
  if (provider === "custom") {
    modelInput.placeholder = "e.g. auto (Manifest), llama3.2, your-gateway-model-id";
    modelInput.removeAttribute("readonly");
  } else {
    modelInput.placeholder = metaDefaultPlaceholder(provider);
    modelInput.removeAttribute("readonly");
  }
}

function metaDefaultPlaceholder(provider) {
  const meta = settingsSnapshot?.providers?.find((p) => p.id === provider);
  return meta?.defaultModel ? `Default: ${meta.defaultModel}` : "";
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
  const modelEl = $("model");
  const current = modelEl.value.trim();
  const prevId = settingsSnapshot?.provider;
  const prevDefault =
    settingsSnapshot?.providers?.find((p) => p.id === prevId)?.defaultModel ?? "";
  const savedModel = (settingsSnapshot?.model ?? "").trim();
  const shouldReplace =
    !current || current === prevDefault || (prevId && current === savedModel && prevId !== provider);
  if (shouldReplace) {
    if (provider === "custom") {
      modelEl.value = savedModel && settingsSnapshot?.provider === "custom" ? savedModel : "";
    } else if (meta?.defaultModel) {
      modelEl.value = meta.defaultModel;
    }
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
  updateSidebarModel();
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
  if (!model && provider !== "custom") {
    model = settingsSnapshot?.providers?.find((p) => p.id === provider)?.defaultModel ?? "";
  }
  if (provider === "custom" && !model) {
    setSettingsStatus(
      "Custom provider needs a model ID (e.g. Manifest routing: auto).",
      "err",
    );
    return;
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
  const activeModel = (settingsSnapshot?.model ?? model).trim();
  setSettingsStatus(
    `Saved — using ${settingsSnapshot?.provider ?? provider} / ${activeModel || "(no model)"}`,
    "ok",
  );
  addSystemNote(`LLM: ${settingsSnapshot?.provider ?? provider} · ${activeModel}`);
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
$("update-apply").addEventListener("click", () => void applyUpdateNow());
$("github-device-copy").addEventListener("click", async () => {
  const code = $("github-device-code").textContent?.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    addSystemNote("Code copied — paste it on GitHub.");
  } catch {
    addSystemNote(`Your code: ${code}`);
  }
});
$("repo-connect-github").addEventListener("click", () => void connectGitHub());
$("repo-logout").addEventListener("click", () => void logoutGitHub());
$("repo-search").addEventListener("input", () => {
  clearTimeout(repoSearchTimer);
  repoSearchTimer = setTimeout(() => void refreshGitHubRepoList($("repo-search").value.trim()), 250);
});
$("provider").addEventListener("change", () => {
  onProviderChange();
  setSettingsStatus("", null);
});

function openSettingsModal() {
  void loadSettings().then(() => openModal("settings-modal"));
}

$("settings-open")?.addEventListener("click", openSettingsModal);
bindModal("settings-modal", "settings-close");

$("composer-input").addEventListener("input", resizeComposer);
$("composer-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal("settings-modal");
});

void loadHealth();
void loadRepo().then(() => {
  if (new URLSearchParams(window.location.search).get("github") === "connected") {
    addSystemNote("GitHub connected. Pick a repository.");
    window.history.replaceState({}, "", "/");
  }
});
void loadSettings();
void loadUpdateStatus();
wireEmptyHints();
void loadRuns();
setStatus("idle");
