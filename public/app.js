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
    const msg = body?.error || (typeof body === "string" ? body : res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
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
<p class="empty-body">The agent reads your mounted repo, proposes edits, and waits for your approval before writing files or running commands.</p>
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
    addSystemNote(msg);
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
  const task = await api(`/tasks/${state.taskId}`);
  setStatus(task.status);
  $("run-title").textContent = task.title || "Agent";
  $("run-meta").textContent = task.id;
  $("approve").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
  $("reject").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
  $("undo").disabled = !task.canUndo;
  renderChanges(task);
  if (task.status === "running" || task.status === "executing") startPoll();
  else stopPoll();
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
      addTurn("user", text);
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

const API_KEY_LABELS = {
  openai: "OpenAI API key",
  anthropic: "Anthropic API key",
  gemini: "Google Gemini API key",
  groq: "Groq API key",
  openrouter: "OpenRouter API key",
  custom: "Custom OpenAI-compatible API key",
};

function syncProviderFields() {
  const provider = $("provider").value;
  $("custom-url-wrap").hidden = provider !== "custom";
  $("api-key-label").textContent = API_KEY_LABELS[provider] ?? "API key";
}

async function loadSettings() {
  const data = await api("/settings");
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
  const masked = data.keys?.[providerKeyField($("provider").value)];
  $("key-hint").textContent = masked
    ? `Saved: ${masked} (leave blank to keep)`
    : "No key saved for this provider yet.";
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
  const payload = {
    provider,
    model: $("model").value.trim(),
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
  $("settings-popover").hidden = true;
  $("settings-toggle").setAttribute("aria-expanded", "false");
  addSystemNote("Settings saved");
  await loadSettings();
}

$("new-run").addEventListener("click", newRun);
$("send-btn").addEventListener("click", () => void sendMessage());
$("approve").addEventListener("click", () => void approve());
$("reject").addEventListener("click", () => void reject());
$("undo").addEventListener("click", () => void undoApply());
$("save-settings").addEventListener("click", () => void saveSettings());
$("provider").addEventListener("change", () => {
  syncProviderFields();
  void loadSettings();
});

$("settings-toggle").addEventListener("click", () => {
  const pop = $("settings-popover");
  const open = pop.hidden;
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
void loadSettings();
void loadRuns();
setStatus("idle");
