import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import { getWorkspaceRoot } from "../config.js";
import { activeRepoSettings, usesActiveRemoteRepo } from "../repo/runtime.js";
import type { RepoSettings } from "../settings/store.js";
import { normalizeRemoteUrl } from "../repo/git.js";

export type PreviewScope = {
  root: string;
  repo: RepoSettings;
};

function repoSlugFromRemote(remoteUrl: string, fullName: string): string {
  const name = fullName.trim().toLowerCase();
  if (name) return name;
  const url = normalizeRemoteUrl(remoteUrl).toLowerCase();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return m?.[1]?.replace(/\.git$/, "") ?? "";
}

function workspaceOriginMatchesRepo(workspaceRoot: string, fullName: string, remoteUrl: string): boolean {
  const expected = repoSlugFromRemote(remoteUrl, fullName);
  if (!expected) return true;
  const gitDir = path.join(workspaceRoot, ".git");
  if (!fs.existsSync(gitDir)) return false;
  try {
    const config = fs.readFileSync(path.join(gitDir, "config"), "utf8");
    const lower = config.toLowerCase();
    const slug = expected.toLowerCase();
    if (lower.includes(slug)) return true;
    const [owner, repo] = slug.split("/");
    if (owner && repo && lower.includes(`${owner}/${repo}`)) return true;
  } catch {
    return false;
  }
  return false;
}

export function resolvePreviewScope(): PreviewScope | { error: string; status: number } {
  if (!usesActiveRemoteRepo()) {
    return {
      error: "Select a GitHub repository in the sidebar before previewing.",
      status: 400,
    };
  }
  const repo = activeRepoSettings();
  const fullName = repo.githubRepoFullName.trim();
  if (!fullName) {
    return {
      error: "Pick the repository you are working on in Workspace, then open Preview.",
      status: 400,
    };
  }
  const root = getWorkspaceRoot();
  if (!fs.existsSync(path.join(root, ".git"))) {
    return {
      error: `Workspace for ${fullName} is not cloned yet. Select the repo again to sync.`,
      status: 400,
    };
  }
  if (!workspaceOriginMatchesRepo(root, fullName, repo.remoteUrl)) {
    return {
      error: `Preview is limited to ${fullName}. This folder is a different clone — re-select the repo in Workspace.`,
      status: 409,
    };
  }
  return { root, repo };
}

export function previewScopeOrResponse(c: Context): PreviewScope | Response {
  const scope = resolvePreviewScope();
  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status as 400 | 409);
  }
  return scope;
}
