import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RepoSettings } from "../settings/store.js";

const execFileAsync = promisify(execFile);

export interface GitStatus {
  root: string;
  isRepo: boolean;
  branch: string | null;
  remoteUrl: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  changedFiles: number;
}

export function normalizeRemoteUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (/^[\w.-]+\/[\w.-]+$/.test(url) && !url.includes("://")) {
    url = `https://github.com/${url}.git`;
  } else if (url.startsWith("github.com/")) {
    url = `https://${url}`;
  } else if (url.startsWith("git@github.com:")) {
    return url;
  }
  if (!url.endsWith(".git") && url.includes("github.com/") && !url.includes("?")) {
    url = `${url.replace(/\/$/, "")}.git`;
  }
  return url;
}

export function authedCloneUrl(remoteUrl: string, token: string): string {
  const url = normalizeRemoteUrl(remoteUrl);
  const t = token.trim();
  if (!t || url.startsWith("git@")) {
    return url;
  }
  try {
    const u = new URL(url);
    if (u.protocol === "https:") {
      u.username = "x-access-token";
      u.password = t;
      return u.toString();
    }
  } catch {
    /* keep raw */
  }
  return url;
}

export function sanitizeGitSecrets(text: string): string {
  return text
    .replace(/x-access-token:[^@\s'"]+@/gi, "x-access-token:***@")
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "github_pat_***")
    .replace(/\bgho_[A-Za-z0-9]+\b/g, "gho_***");
}

function friendlyGitHubCloneError(sanitized: string): string | null {
  const lower = sanitized.toLowerCase();
  if (
    lower.includes("repository not found") ||
    lower.includes("could not read from remote repository")
  ) {
    return (
      'GitHub returned "repository not found". Verify the repo exists and your account can open it on github.com. ' +
      "Then reconnect: Sign in with GitHub (OAuth) or paste a PAT with access to that repo (classic: repo scope; fine-grained: Contents read on the repo). " +
      "If a token appeared in an error message, revoke it on GitHub and connect again."
    );
  }
  return null;
}

function rethrowGitError(err: unknown): never {
  const raw = err instanceof Error ? err.message : String(err);
  const sanitized = sanitizeGitSecrets(raw);
  const friendly = friendlyGitHubCloneError(sanitized);
  throw new Error(friendly ?? sanitized);
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    rethrowGitError(err);
  }
}

function isEmptyDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).length === 0;
}

/** Checkout local branch at the commit pointed to by origin/<branch> (never use origin/branch as checkout target). */
async function checkoutRemoteBranch(cwd: string, branch: string): Promise<void> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  let commit = "";
  try {
    const res = await runGit(cwd, ["rev-parse", "--verify", remoteRef]);
    commit = res.stdout.trim();
  } catch {
    throw new Error(
      `origin/${branch} is missing after fetch (network error or empty remote). ` +
        `Try again or run: git -C "${cwd}" fetch origin ${branch}`,
    );
  }
  await runGit(cwd, ["checkout", "-B", branch, commit]);
}

export async function syncRepository(
  workspaceRoot: string,
  repo: RepoSettings,
): Promise<{ action: "clone" | "pull"; branch: string }> {
  const remoteUrl = normalizeRemoteUrl(repo.remoteUrl);
  if (!remoteUrl) {
    throw new Error("Repository URL is required");
  }
  const branch = repo.branch.trim() || "main";
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const gitDir = path.join(workspaceRoot, ".git");
  if (fs.existsSync(gitDir)) {
    await runGit(workspaceRoot, ["fetch", "origin", branch]);
    await runGit(workspaceRoot, ["checkout", branch]).catch(async () => {
      await checkoutRemoteBranch(workspaceRoot, branch);
    });
    await runGit(workspaceRoot, ["pull", "--ff-only", "origin", branch]).catch(async () => {
      await runGit(workspaceRoot, ["pull", "origin", branch]);
    });
    await applyGitIdentity(workspaceRoot, repo);
    return { action: "pull", branch };
  }

  if (!isEmptyDir(workspaceRoot)) {
    throw new Error(
      "Workspace is not empty and is not a git repo. Use an empty folder or remove existing files before cloning.",
    );
  }

  const cloneUrl = authedCloneUrl(remoteUrl, repo.gitToken);
  if (!repo.gitToken.trim() && remoteUrl.includes("github.com")) {
    throw new Error(
      "GitHub clone requires a token. Sign in with GitHub or paste a PAT with repo access, then select the repository again.",
    );
  }
  await shallowCloneWithBranch(process.cwd(), cloneUrl, workspaceRoot, branch);
  await runGit(workspaceRoot, ["remote", "set-url", "origin", remoteUrl]);
  await applyGitIdentity(workspaceRoot, repo);
  return { action: "clone", branch };
}

async function shallowCloneWithBranch(
  cwd: string,
  cloneUrl: string,
  workspaceRoot: string,
  branch: string,
): Promise<void> {
  try {
    await runGit(cwd, [
      "clone",
      "--depth",
      "1",
      "--branch",
      branch,
      cloneUrl,
      workspaceRoot,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/remote branch .* not found|could not find remote branch/i.test(msg)) {
      throw err;
    }
    await runGit(cwd, ["clone", "--depth", "1", cloneUrl, workspaceRoot]);
    await runGit(workspaceRoot, ["checkout", branch]).catch(async () => {
      await checkoutRemoteBranch(workspaceRoot, branch);
    });
  }
}

export async function getGitStatus(workspaceRoot: string): Promise<GitStatus> {
  const base: GitStatus = {
    root: workspaceRoot,
    isRepo: false,
    branch: null,
    remoteUrl: null,
    clean: true,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
  };
  if (!fs.existsSync(path.join(workspaceRoot, ".git"))) {
    return base;
  }
  base.isRepo = true;
  try {
    const branch = await runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    base.branch = branch.stdout.trim() || null;
  } catch {
    /* ignore */
  }
  try {
    const remote = await runGit(workspaceRoot, ["remote", "get-url", "origin"]);
    base.remoteUrl = sanitizeRemoteForDisplay(remote.stdout.trim());
  } catch {
    /* ignore */
  }
  try {
    const status = await runGit(workspaceRoot, ["status", "--porcelain"]);
    const lines = status.stdout.trim().split("\n").filter(Boolean);
    base.changedFiles = lines.length;
    base.clean = lines.length === 0;
  } catch {
    /* ignore */
  }
  const branchName = base.branch ?? "main";
  try {
    await runGit(workspaceRoot, ["fetch", "origin", branchName]);
    const counts = await runGit(workspaceRoot, [
      "rev-list",
      "--left-right",
      "--count",
      `origin/${branchName}...HEAD`,
    ]);
    const parts = counts.stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      base.behind = Number(parts[0]) || 0;
      base.ahead = Number(parts[1]) || 0;
    }
  } catch {
    /* offline or no remote */
  }
  return base;
}

function sanitizeRemoteForDisplay(url: string): string {
  return sanitizeGitSecrets(url.replace(/x-access-token:[^@]+@/i, "x-access-token:***@"));
}

export async function applyGitIdentity(workspaceRoot: string, repo: RepoSettings): Promise<void> {
  if (!fs.existsSync(path.join(workspaceRoot, ".git"))) return;
  const name = repo.gitAuthorName.trim();
  const email = repo.gitAuthorEmail.trim();
  if (name) {
    await runGit(workspaceRoot, ["config", "user.name", name]);
  }
  if (email) {
    await runGit(workspaceRoot, ["config", "user.email", email]);
  }
}

export async function commitAndPush(
  workspaceRoot: string,
  repo: RepoSettings,
  message: string,
  paths: string[],
): Promise<{ commit: string; pushed: boolean }> {
  if (!fs.existsSync(path.join(workspaceRoot, ".git"))) {
    throw new Error("Workspace is not a git repository");
  }
  const branch = repo.branch.trim() || "main";
  const publicRemote = normalizeRemoteUrl(repo.remoteUrl);

  await applyGitIdentity(workspaceRoot, repo);

  const addArgs = paths.length ? ["add", "--", ...paths] : ["add", "-A"];
  await runGit(workspaceRoot, addArgs);
  const staged = await runGit(workspaceRoot, ["diff", "--cached", "--name-only"]);
  if (!staged.stdout.trim()) {
    return { commit: "", pushed: false };
  }
  await runGit(workspaceRoot, ["commit", "-m", message]);
  const rev = await runGit(workspaceRoot, ["rev-parse", "--short", "HEAD"]);
  const token = repo.gitToken.trim();
  if (token) {
    await runGit(workspaceRoot, [
      "remote",
      "set-url",
      "origin",
      authedCloneUrl(publicRemote, token),
    ]);
  }
  await runGit(workspaceRoot, ["push", "origin", branch]);
  if (publicRemote) {
    await runGit(workspaceRoot, ["remote", "set-url", "origin", publicRemote]);
  }
  return { commit: rev.stdout.trim(), pushed: true };
}

export function isWorkspaceReady(workspaceRoot: string, remoteConfigured: boolean): boolean {
  if (!remoteConfigured) {
    return fs.existsSync(workspaceRoot);
  }
  return fs.existsSync(path.join(workspaceRoot, ".git"));
}
