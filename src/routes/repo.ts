import { Hono } from "hono";
import { z } from "zod";
import { getWorkspaceRoot } from "../config.js";
import {
  applyGitIdentity,
  commitAndPush,
  getGitStatus,
  isWorkspaceReady,
  syncRepository,
} from "../repo/git.js";
import {
  defaultBotDisplayName,
  fetchGitHubUser,
  githubNoreplyEmail,
} from "../repo/github.js";
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
  gitAuthorName: z.string().optional(),
  gitAuthorEmail: z.string().optional(),
  githubLogin: z.string().optional(),
});

const linkSchema = z.object({
  gitToken: z.string().optional(),
  botDisplayName: z.string().optional(),
});

repo.get("/", async (c) => {
  const settings = loadAppSettings();
  const root = getWorkspaceRoot();
  const git = await getGitStatus(root);
  let github: Awaited<ReturnType<typeof fetchGitHubUser>> | null = null;
  const token = settings.repo.gitToken.trim();
  if (token) {
    try {
      github = await fetchGitHubUser(token);
    } catch {
      github = null;
    }
  }
  return c.json({
    workspace: root,
    mode: usesRemoteRepo(settings) ? "remote" : "mount",
    configured: maskedRepo(settings),
    github: github
      ? {
          login: github.login,
          id: github.id,
          name: github.name,
          html_url: github.html_url,
          avatar_url: github.avatar_url,
          suggestedEmail: githubNoreplyEmail(github.id, github.login),
        }
      : null,
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
  if (data.gitAuthorName !== undefined) repoPatch.gitAuthorName = data.gitAuthorName.trim();
  if (data.gitAuthorEmail !== undefined) repoPatch.gitAuthorEmail = data.gitAuthorEmail.trim();
  if (data.githubLogin !== undefined) repoPatch.githubLogin = data.githubLogin.trim();

  const next = updateAppSettings({ repo: repoPatch });
  const root = getWorkspaceRoot();
  await applyGitIdentity(root, next.repo).catch(() => {});
  return c.json({ configured: maskedRepo(next) });
});

repo.post("/github/link", async (c) => {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty */
  }
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
  }

  const settings = loadAppSettings();
  const token = parsed.data.gitToken?.trim() || settings.repo.gitToken.trim();
  if (!token) {
    return c.json({ error: "Save a GitHub personal access token first" }, 400);
  }

  let user;
  try {
    user = await fetchGitHubUser(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }

  const botName = parsed.data.botDisplayName?.trim() || defaultBotDisplayName(user);
  const botEmail = githubNoreplyEmail(user.id, user.login);

  const next = updateAppSettings({
    repo: {
      gitToken: token,
      githubLogin: user.login,
      gitAuthorName: botName,
      gitAuthorEmail: botEmail,
    },
  });

  const root = getWorkspaceRoot();
  await applyGitIdentity(root, next.repo).catch(() => {});

  return c.json({
    ok: true,
    github: {
      login: user.login,
      id: user.id,
      name: user.name,
      html_url: user.html_url,
      avatar_url: user.avatar_url,
      commitEmail: botEmail,
      commitName: botName,
    },
    configured: maskedRepo(next),
  });
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
