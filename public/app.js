const $ = (id) => document.getElementById(id);

const logEl = $("log");
const proposalPanel = $("proposal-panel");
const EVENT_TYPES = [
  "log",
  "tool",
  "proposal",
  "awaiting_approval",
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

let currentTaskId = null;
let eventSource = null;
let pollTimer = null;

function appendLog(line, className = "") {
  const span = document.createElement("span");
  span.className = `log-line ${className}`.trim();
  span.textContent = `${line}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = "";
}

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

async function loadHealth() {
  const pill = $("health-pill");
  try {
    const data = await api("/health");
    pill.textContent = "online";
    pill.className = "pill ok";
    $("workspace").textContent = `workspace: ${data.workspace}`;
  } catch {
    pill.textContent = "offline";
    pill.className = "pill bad";
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
  toggleCustomUrl();
}

function toggleCustomUrl() {
  $("custom-url-wrap").hidden = $("provider").value !== "custom";
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
  appendLog("[ui] Settings saved", "done");
  await loadSettings();
}

function closeStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function handleStreamEvent(ev) {
  let payload;
  try {
    payload = JSON.parse(ev.data);
  } catch {
    return;
  }
  const type = ev.type || "message";
  const msg = payload.message ?? "";
  if (type === "command_stdout" || type === "command_stderr") {
    appendLog(msg, "cmd");
    return;
  }
  if (type === "stream_end") {
    appendLog("— stream ended —", "tool");
    void refreshTask();
    return;
  }
  const cls =
    type === "error" ? "error" : type === "done" ? "done" : type === "tool" ? "tool" : "";
  appendLog(`[${type}] ${msg}`, cls);
  if (type === "awaiting_approval" || type === "proposal") {
    void refreshTask();
  }
}

function connectStream(taskId) {
  closeStream();
  const es = new EventSource(`/tasks/${taskId}/stream`);
  eventSource = es;
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, handleStreamEvent);
  }
  es.onerror = () => {
    appendLog("[ui] stream disconnected (task may still be running)", "tool");
  };
}

function renderProposal(task) {
  const p = task.pendingProposal;
  if (!p || task.status !== "awaiting_approval") {
    proposalPanel.hidden = true;
    return;
  }
  proposalPanel.hidden = false;
  $("proposal-summary").textContent = p.summary;
  const filesEl = $("proposal-files");
  filesEl.innerHTML = "";
  for (const f of p.files) {
    const block = document.createElement("div");
    block.className = "file-block";
    block.innerHTML = `<header>${escapeHtml(f.path)}</header><pre></pre>`;
    block.querySelector("pre").textContent = f.content;
    filesEl.appendChild(block);
  }
  const cmdEl = $("proposal-commands");
  if (p.commands?.length) {
    cmdEl.innerHTML = "<strong>Commands after approve</strong><ul></ul>";
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

async function refreshTask() {
  if (!currentTaskId) return;
  try {
    const task = await api(`/tasks/${currentTaskId}`);
    $("task-status").textContent = task.status;
    $("approve").disabled = task.status !== "awaiting_approval" || !task.pendingProposal;
    $("undo").disabled = !task.canUndo;
    renderProposal(task);
    if (task.status === "running" || task.status === "executing") {
      startPoll();
    } else {
      stopPoll();
    }
  } catch (e) {
    appendLog(`[ui] ${e.message}`, "error");
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => void refreshTask(), 2000);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function runTask() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("run-task").disabled = true;
  clearLog();
  proposalPanel.hidden = true;
  try {
    const task = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    currentTaskId = task.id;
    $("task-status").textContent = task.status;
    appendLog(`[ui] Task ${task.id}`, "done");
    connectStream(task.id);
    startPoll();
  } catch (e) {
    appendLog(`[ui] ${e.message}`, "error");
  } finally {
    $("run-task").disabled = false;
  }
}

async function approveTask() {
  if (!currentTaskId) return;
  $("approve").disabled = true;
  try {
    appendLog("[ui] Approving…", "tool");
    await api(`/tasks/${currentTaskId}/approve`, { method: "POST", body: "{}" });
    connectStream(currentTaskId);
    await refreshTask();
  } catch (e) {
    appendLog(`[ui] ${e.message}`, "error");
  }
}

async function undoTask() {
  if (!currentTaskId) return;
  try {
    const res = await api(`/tasks/${currentTaskId}/undo`, { method: "POST", body: "{}" });
    appendLog(`[ui] Undid changes to: ${res.files?.join(", ") || "files"}`, "done");
    await refreshTask();
  } catch (e) {
    appendLog(`[ui] ${e.message}`, "error");
  }
}

$("save-settings").addEventListener("click", () => void saveSettings());
$("provider").addEventListener("change", toggleCustomUrl);
$("run-task").addEventListener("click", () => void runTask());
$("approve").addEventListener("click", () => void approveTask());
$("undo").addEventListener("click", () => void undoTask());

void loadHealth();
void loadSettings();
