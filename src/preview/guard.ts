import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import { getWorkspaceRoot } from "../config.js";
import { activeRepoSettings, usesActiveRemoteRepo } from "../repo/runtime.js";
import type { RepoSettings } from "../settings/store.js";

export type PreviewScope = {
  root: string;
  repo: RepoSettings;
};

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
  return { root, repo };
}

export function previewScopeOrResponse(c: Context): PreviewScope | Response {
  const scope = resolvePreviewScope();
  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status as 400);
  }
  return scope;
}
