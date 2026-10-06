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
  getGitHubOAuthClientId,
  getRepoByFullName,
  githubNoreplyEmail,
  listUserRepos,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow,
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
  githubRepoFullName: z.string().optional(),
});

const linkSchema = z.object({
  gitToken: z.string().optional(),
  botDisplayName: z.string().optional(),
});

const selectSchema = z.object({
  fullName: z.string().min(3),
  sync: z.boolean().optional(),
});

const devicePollSchema = z.object({
  deviceCode: z.string().min(1),
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
    githubDeviceFlowAvailable: Boolean(getGitHubOAuthClientId()),
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
  if (data.githubRepoFullName !== undefined) {
    repoPatch.githubRepoFullName = data.githubRepoFullName.trim();
  }

  const next = updateAppSettings({ repo: repoPatch });
  const root = getWorkspaceRoot();
  await applyGitIdentity(root, next.repo).catch(() => {});
  return c.json({ configured: maskedRepo(next) });
});

repo.get("/github/repos", async (c) => {
  const settings = loadAppSettings();
  const token = settings.repo.gitToken.trim();
  if (!token) {
    return c.json({ error: "Connect GitHub first (token required)" }, 401);
  }
  const q = c.req.query("q") ?? "";
  const page = Number(c.req.query("page") ?? "1") || 1;
  try {
    const repos = await listUserRepos(token, { page, perPage: 50, q });
    return c.json({ repos, page, count: repos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

repo.post("/github/select", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
  }

  const settings = loadAppSettings();
  const token = settings.repo.gitToken.trim();
  if (!token) {
    return c.json({ error: "Connect GitHub first" }, 401);
  }

  const fullName = parsed.data.fullName.trim();
  let meta;
  try {
    meta = await getRepoByFullName(token, fullName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }

  const branch = meta.default_branch || "main";
  const remoteUrl = meta.clone_url || `https://github.com/${fullName}.git`;

  const next = updateAppSettings({
    repo: {
      remoteUrl,
      branch,
      githubRepoFullName: fullName,
    },
  });

  const root = getWorkspaceRoot();
  let syncResult: Awaited<ReturnType<typeof syncRepository>> | null = null;
  if (parsed.data.sync !== false) {
    try {
      syncResult = await syncRepository(root, next.repo);
      await applyGitIdentity(root, next.repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: message,
          configured: maskedRepo(next),
          selected: { fullName, branch, remoteUrl },
        },
        400,
      );
    }
  }

  const git = await getGitStatus(root);
  return c.json({
    ok: true,
    selected: { fullName, branch, remoteUrl },
    sync: syncResult,
    configured: maskedRepo(next),
    git,
    ready: isWorkspaceReady(root, true),
  });
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
    return c.json({ error: "Paste a GitHub token, then Connect" }, 400);
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

  let repos: Awaited<ReturnType<typeof listUserRepos>> = [];
  try {
    repos = await listUserRepos(token, { perPage: 30 });
  } catch {
    /* list optional on link */
  }

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
    repos,
    configured: maskedRepo(next),
  });
});

repo.post("/github/device/start", async (c) => {
  const clientId = getGitHubOAuthClientId();
  if (!clientId) {
    return c.json(
      {
        error:
          "GitHub device sign-in is not configured. Set GITHUB_OAUTH_CLIENT_ID on the server, or use a personal access token.",
      },
      501,
    );
  }
  try {
    const flow = await startGitHubDeviceFlow(clientId);
    return c.json({
      user_code: flow.user_code,
      verification_uri: flow.verification_uri,
      device_code: flow.device_code,
      expires_in: flow.expires_in,
      interval: flow.interval,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

repo.post("/github/device/poll", async (c) => {
  const clientId = getGitHubOAuthClientId();
  if (!clientId) {
    return c.json({ error: "Device flow not configured" }, 501);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = devicePollSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "deviceCode required" }, 400);
  }
  try {
    const result = await pollGitHubDeviceFlow(clientId, parsed.data.deviceCode);
    if ("pending" in result && result.pending) {
      return c.json({ status: "pending" });
    }
    if ("slowDown" in result && result.slowDown) {
      return c.json({ status: "slow_down" });
    }
    if (!("access_token" in result)) {
      return c.json({ status: "pending" });
    }
    const accessToken = result.access_token;
    const user = await fetchGitHubUser(accessToken);
    const botEmail = githubNoreplyEmail(user.id, user.login);
    const next = updateAppSettings({
      repo: {
        gitToken: accessToken,
        githubLogin: user.login,
        gitAuthorName: defaultBotDisplayName(user),
        gitAuthorEmail: botEmail,
      },
    });
    const repos = await listUserRepos(accessToken, { perPage: 30 });
    return c.json({
      status: "ok",
      github: {
        login: user.login,
        html_url: user.html_url,
        avatar_url: user.avatar_url,
      },
      repos,
      configured: maskedRepo(next),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, status: "error" }, 400);
  }
});

repo.post("/sync", async (c) => {
  const settings = loadAppSettings();
  if (!settings.repo.remoteUrl.trim()) {
    return c.json({ error: "Select a repository first" }, 400);
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
