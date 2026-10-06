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

const state = {
  taskId: null,
  status: "idle",
  eventSource: null,
  pollTimer: null,
  seenEventIds: new Set(),
  terminalEl: null,
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
  const chip = $("status-chip");
  chip.textContent = status.replace(/_/g, " ");
  chip.className = `status-chip ${status}`;
}

function appendChatNode(node) {
  $("chat-thread").appendChild(node);
  $("chat-thread").scrollTop = $("chat-thread").scrollHeight;
}

function addUserBubble(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  appendChatNode(el);
}

function addAgentBubble(text) {
  const el = document.createElement("div");
  el.className = "msg agent";
  el.textContent = text;
  appendChatNode(el);
}

function addSystemLine(text) {
  const el = document.createElement("div");
  el.className = "msg system";
  el.textContent = text;
  appendChatNode(el);
}

function addToolPill(text) {
  const el = document.createElement("div");
  el.className = "tool-pill";
  el.textContent = text;
  appendChatNode(el);
}

function ensureTerminal() {
  if (!state.terminalEl) {
    state.terminalEl = document.createElement("pre");
    state.terminalEl.className = "terminal";
    appendChatNode(state.terminalEl);
  }
  return state.terminalEl;
}

function appendTerminal(line) {
  const t = ensureTerminal();
  t.textContent += `${line}\n`;
  $("chat-thread").scrollTop = $("chat-thread").scrollHeight;
}

function clearChat() {
  $("chat-thread").innerHTML = "";
  state.terminalEl = null;
  state.seenEventIds.clear();
}

function ingestEvent(ev, replay = false) {
  if (state.seenEventIds.has(ev.id)) return;
  state.seenEventIds.add(ev.id);

  const type = ev.type;
  const msg = ev.message ?? "";
  const role = ev.data?.role;

  if (type === "message") {
    if (role === "user") addUserBubble(msg);
    else addAgentBubble(msg);
    return;
  }
  if (type === "log") {
    addAgentBubble(msg);
    return;
  }
  if (type === "tool") {
    addToolPill(msg);
    return;
  }
  if (type === "command_stdout" || type === "command_stderr") {
    appendTerminal(msg);
    return;
  }
  if (type === "command_exit") {
    appendTerminal(`↳ ${msg}`);
    return;
  }
  if (type === "error") {
    addSystemLine(`Error: ${msg}`);
    return;
  }
  if (type === "done") {
    addSystemLine(msg);
    return;
  }
  if (type === "rejected") {
    addSystemLine(`Rejected${msg ? `: ${msg}` : ""}`);
    return;
  }
  if (type === "status" && !replay) {
    if (ev.data?.status) setStatus(ev.data.status);
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
      if (n !== undefined) out.push({ t: "ctx", l: n });
    } else {
      if (o !== undefined) out.push({ t: "del", l: `- ${o}` });
      if (n !== undefined) out.push({ t: "add", l: `+ ${n}` });
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
    const tag = f.isNew ? " (new)" : "";
    card.innerHTML = `<header>${escapeHtml(f.path)}${tag}</header>`;
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
    cmdEl.innerHTML = "<strong>After approve</strong><ul></ul>";
    const ul = cmdEl.querySelector("ul");
    for (const c of p.commands) {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    }
  } else {
    cmdEl.innerHTML = "";
  }

  $("approve").disabled = false;
  $("reject").disabled = false;
}

async function refreshTask() {
  if (!state.taskId) return;
  const task = await api(`/tasks/${state.taskId}`);
  setStatus(task.status);
  $("run-title").textContent = task.title || "Agent run";
  $("run-meta").textContent = task.id;
  $("approve").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
  $("reject").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
  $("undo").disabled = !task.canUndo;
  renderChanges(task);

  if (task.status === "running" || task.status === "executing") {
    startPoll();
  } else {
    stopPoll();
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
  for (const run of data.tasks) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `run-item${run.id === state.taskId ? " active" : ""}`;
    btn.innerHTML = `<div class="run-item-title">${escapeHtml(run.title)}</div><div class="run-item-meta">${escapeHtml(run.status.replace(/_/g, " "))}</div>`;
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
  for (const ev of evData.events) {
    ingestEvent(ev, true);
  }
  renderChanges(task);
  await loadRuns();
  if (["running", "executing", "awaiting_approval"].includes(task.status)) {
    connectStream(taskId);
  }
  if (task.status === "running" || task.status === "executing") {
    startPoll();
  }
}

function newRun() {
  state.taskId = null;
  clearChat();
  closeStream();
  stopPoll();
  setStatus("idle");
  $("run-title").textContent = "New agent run";
  $("run-meta").textContent = "Describe a coding task below";
  $("changes-panel").hidden = true;
  $("composer-input").focus();
  void loadRuns();
}

async function sendMessage() {
  const text = $("composer-input").value.trim();
  if (!text) return;
  $("send-btn").disabled = true;
  try {
    if (!state.taskId) {
      addUserBubble(text);
      const task = await api("/tasks", {
        method: "POST",
        body: JSON.stringify({ prompt: text }),
      });
      state.taskId = task.id;
      $("composer-input").value = "";
      setStatus(task.status);
      connectStream(task.id);
      startPoll();
      await loadRuns();
      await refreshTask();
    } else {
      if (state.status === "awaiting_approval") {
        throw new Error("Approve or reject pending changes first");
      }
      if (state.status === "running" || state.status === "executing") {
        throw new Error("Agent is still working");
      }
      addUserBubble(text);
      $("composer-input").value = "";
      await api(`/tasks/${state.taskId}/message`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setStatus("running");
      connectStream(state.taskId);
      startPoll();
    }
  } catch (e) {
    addSystemLine(e.message);
  } finally {
    $("send-btn").disabled = false;
  }
}

async function approve() {
  if (!state.taskId) return;
  $("approve").disabled = true;
  try {
    addSystemLine("Approved — applying changes…");
    await api(`/tasks/${state.taskId}/approve`, { method: "POST", body: "{}" });
    connectStream(state.taskId);
    await refreshTask();
  } catch (e) {
    addSystemLine(e.message);
  }
}

async function reject() {
  if (!state.taskId) return;
  const feedback = window.prompt("Optional feedback for the agent:") ?? "";
  $("reject").disabled = true;
  try {
    await api(`/tasks/${state.taskId}/reject`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
    connectStream(state.taskId);
    await refreshTask();
  } catch (e) {
    addSystemLine(e.message);
  }
}

async function undoApply() {
  if (!state.taskId) return;
  try {
    const res = await api(`/tasks/${state.taskId}/undo`, { method: "POST", body: "{}" });
    addSystemLine(`Undid apply: ${(res.files || []).join(", ")}`);
    await refreshTask();
  } catch (e) {
    addSystemLine(e.message);
  }
}

async function loadHealth() {
  try {
    const data = await api("/health");
    $("workspace").textContent = data.workspace;
  } catch {
    $("workspace").textContent = "offline";
  }
}

async function loadSettings() {
  const data = await api("/settings");
  const select = $("provider");
  select.innerHTML = "";
  for (const p of data.providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.configured ? p.id : `${p.id} (no key)`;
    if (p.id === data.provider) opt.selected = true;
    select.appendChild(opt);
  }
  $("model").value = data.model || "";
  $("custom-base-url").value = data.customBaseUrl || "";
  $("custom-url-wrap").hidden = data.provider !== "custom";
}

async function saveSettings() {
  const payload = {
    provider: $("provider").value,
    model: $("model").value.trim(),
  };
  if ($("provider").value === "custom") {
    payload.customBaseUrl = $("custom-base-url").value.trim();
  }
  await api("/settings", { method: "PATCH", body: JSON.stringify(payload) });
  addSystemLine("Settings saved");
  await loadSettings();
}

$("new-run").addEventListener("click", newRun);
$("send-btn").addEventListener("click", () => void sendMessage());
$("approve").addEventListener("click", () => void approve());
$("reject").addEventListener("click", () => void reject());
$("undo").addEventListener("click", () => void undoApply());
$("save-settings").addEventListener("click", () => void saveSettings());
$("provider").addEventListener("change", () => {
  $("custom-url-wrap").hidden = $("provider").value !== "custom";
});

$("composer-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

void loadHealth();
void loadSettings();
void loadRuns();
newRun();
