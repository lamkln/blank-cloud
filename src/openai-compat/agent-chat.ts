import { createTask, getTask } from "../tasks/store.js";
import { runAgentTurn } from "../tasks/agent.js";
import { isWorkspaceReady, syncRepository } from "../repo/git.js";
import { getWorkspaceRoot } from "../config.js";
import { activeRepoSettings, usesActiveRemoteRepo } from "../repo/runtime.js";
import { runWithUserContext } from "../context/request.js";
import { buildUserContext } from "../auth/middleware.js";
import { loadUser } from "../auth/users.js";
import { usePerUserGitHubStorage } from "../auth/connect-github.js";
import { loadAppSettings, usesRemoteRepo } from "../settings/store.js";

function openAiCompatGithubLogin(): string | null {
  return process.env.BLANK_CLOUD_API_GITHUB_LOGIN?.trim() || null;
}

function remoteConfiguredForOpenAi(): boolean {
  const login = openAiCompatGithubLogin();
  if (login) {
    const user = loadUser(login);
    return Boolean(user?.repo.remoteUrl.trim() || user?.repo.githubRepoFullName.trim());
  }
  if (usePerUserGitHubStorage()) {
    return false;
  }
  return usesRemoteRepo(loadAppSettings());
}

function extractUserPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i] as { role?: string; content?: unknown };
    if (row?.role !== "user") continue;
    const c = row.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      return c
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String((part as { text?: string }).text ?? "");
          }
          return "";
        })
        .join("")
        .trim();
    }
  }
  return "";
}

function formatAgentReply(taskId: string): string {
  const task = getTask(taskId);
  if (!task) return "";
  const parts = task.messages.filter((m) => m.role === "assistant").map((m) => m.content.trim());
  let text = parts.filter(Boolean).join("\n\n");
  if (task.pendingProposal) {
    const files = task.pendingProposal.files.map((f) => f.path).join(", ");
    text += `\n\n[blank-cloud] Proposed changes (approve in Web UI): ${task.pendingProposal.summary}`;
    if (files) text += `\nFiles: ${files}`;
  }
  if (task.status === "failed" && task.lastError) {
    text += `\n\n[error] ${task.lastError}`;
  }
  return text.trim() || "(No assistant reply — check blank-cloud Web UI for tool output.)";
}

async function ensureAgentWorkspace(): Promise<string> {
  const root = getWorkspaceRoot();
  const remoteOn = remoteConfiguredForOpenAi() || usesActiveRemoteRepo();
  if (!remoteOn) {
    if (!isWorkspaceReady(root, false)) {
      throw new Error(`Workspace path missing: ${root}`);
    }
    return root;
  }
  if (!isWorkspaceReady(root, true)) {
    const repo = activeRepoSettings();
    const remoteUrl =
      repo.remoteUrl.trim() ||
      (repo.githubRepoFullName.trim()
        ? `https://github.com/${repo.githubRepoFullName.trim()}.git`
        : "");
    if (!remoteUrl || !repo.gitToken.trim()) {
      throw new Error(
        `Workspace not ready at ${root} — connect GitHub and select a repo in the Web UI (not WORKSPACE mount).`,
      );
    }
    await syncRepository(root, { ...repo, remoteUrl });
  }
  if (!isWorkspaceReady(root, true)) {
    throw new Error(`Workspace not ready at ${root} after git sync.`);
  }
  return root;
}

async function runAgentOnce(prompt: string): Promise<string> {
  const root = await ensureAgentWorkspace();
  const owner = openAiCompatGithubLogin();
  const task = createTask(prompt, owner);
  await runAgentTurn(task.id);
  return formatAgentReply(task.id);
}

export async function runCodingAgentForOpenAiCompat(messages: unknown): Promise<string> {
  const prompt = extractUserPrompt(messages);
  if (!prompt) {
    throw new Error("messages must include a user message");
  }
  if (usePerUserGitHubStorage()) {
    const login = openAiCompatGithubLogin();
    if (!login) {
      throw new Error(
        "Set BLANK_CLOUD_API_GITHUB_LOGIN to your GitHub username (same as Web UI sign-in).",
      );
    }
    const user = loadUser(login);
    if (!user?.gitToken) {
      throw new Error(
        `GitHub user "${login}" is not connected — sign in via Web UI first, then set BLANK_CLOUD_API_GITHUB_LOGIN.`,
      );
    }
    return runWithUserContext(buildUserContext(user), () => runAgentOnce(prompt));
  }
  return runAgentOnce(prompt);
}
