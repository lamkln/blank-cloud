import { Hono } from "hono";
import { z } from "zod";
import { getWorkspaceRoot } from "../config.js";
import { commitAndPush, getGitStatus, syncRepository, isWorkspaceReady } from "../repo/git.js";
import {
  loadAppSettings,
  maskedRepo,
  updateAppSettings,
  usesRemoteRepo,
} from "../settings/store.js";

const repo = new Hono();

const patchSchema = z.object({
  remoteUrl: z.string().optional(),
  branch: z.string().optional(),
  gitToken: z.string().optional(),
  pushOnApprove: z.boolean().optional(),
});

repo.get("/", async (c) => {
  const settings = loadAppSettings();
  const root = getWorkspaceRoot();
  const git = await getGitStatus(root);
  return c.json({
    workspace: root,
    mode: usesRemoteRepo(settings) ? "remote" : "mount",
    configured: maskedRepo(settings),
    git,
    ready: isWorkspaceReady(root, usesRemoteRepo(settings)),
  });
});

repo.patch("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid repo settings", details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const repoPatch: Record<string, string | boolean> = {};
  if (data.remoteUrl !== undefined) repoPatch.remoteUrl = data.remoteUrl.trim();
  if (data.branch !== undefined) repoPatch.branch = data.branch.trim() || "main";
  if (data.gitToken !== undefined && data.gitToken.trim()) {
    repoPatch.gitToken = data.gitToken.trim();
  }
  if (data.pushOnApprove !== undefined) repoPatch.pushOnApprove = data.pushOnApprove;

  const next = updateAppSettings({ repo: repoPatch });
  return c.json({ configured: maskedRepo(next) });
});

repo.post("/sync", async (c) => {
  const settings = loadAppSettings();
  if (!settings.repo.remoteUrl.trim()) {
    return c.json({ error: "Save a repository URL first" }, 400);
  }
  const root = getWorkspaceRoot();
  try {
    const result = await syncRepository(root, settings.repo);
    const git = await getGitStatus(root);
    return c.json({ ok: true, ...result, workspace: root, git });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

repo.post("/push", async (c) => {
  const settings = loadAppSettings();
  let message = "blank-cloud agent changes";
  try {
    const body = await c.req.json();
    if (body?.message?.trim()) message = body.message.trim();
  } catch {
    /* default message */
  }
  const root = getWorkspaceRoot();
  try {
    const result = await commitAndPush(root, settings.repo, message, []);
    const git = await getGitStatus(root);
    return c.json({ ok: true, ...result, git });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

export { repo as repoRoutes };
