export interface GitHubUserPublic {
  login: string;
  id: number;
  name: string | null;
  html_url: string;
  avatar_url: string;
  type: string;
}

export interface GitHubRepoSummary {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  description: string | null;
  updated_at: string;
  permissions?: { push?: boolean; admin?: boolean };
}

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "blank-cloud-agent",
};

import { resolveGitHubOAuthClientId } from "../auth/github-client-id.js";

export function getGitHubOAuthClientId(): string {
  return resolveGitHubOAuthClientId();
}

export { hasGitHubConnectClientId, resolveGitHubOAuthClientId } from "../auth/github-client-id.js";

export function githubNoreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

export function defaultBotDisplayName(user: GitHubUserPublic): string {
  const trimmed = user.name?.trim();
  if (trimmed) return trimmed;
  return user.login;
}

async function parseGitHubError(res: Response, text: string): Promise<string> {
  let detail = text.slice(0, 300);
  try {
    const j = JSON.parse(text) as { message?: string };
    if (j.message) detail = j.message;
  } catch {
    /* keep */
  }
  return `GitHub API error (HTTP ${res.status}): ${detail}`;
}

export async function githubApiGet<T>(
  token: string,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`https://api.github.com${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token.trim()}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(await parseGitHubError(res, text));
  }
  return JSON.parse(text) as T;
}

export async function fetchGitHubUser(token: string): Promise<GitHubUserPublic> {
  const t = token.trim();
  if (!t) {
    throw new Error("GitHub token is required");
  }
  const user = await githubApiGet<GitHubUserPublic>(t, "/user");
  if (!user.login) {
    throw new Error("Unexpected GitHub API response");
  }
  return user;
}

export async function listUserRepos(
  token: string,
  opts: { page?: number; perPage?: number; q?: string } = {},
): Promise<GitHubRepoSummary[]> {
  const page = opts.page ?? 1;
  const perPage = Math.min(opts.perPage ?? 50, 100);
  let repos = await githubApiGet<GitHubRepoSummary[]>(token, "/user/repos", {
    affiliation: "owner,collaborator,organization_member",
    sort: "updated",
    direction: "desc",
    per_page: String(perPage),
    page: String(page),
  });
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    repos = repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }
  return repos;
}

export async function getRepoByFullName(
  token: string,
  fullName: string,
): Promise<GitHubRepoSummary> {
  const name = fullName.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) {
    throw new Error("Invalid repository name (expected owner/repo)");
  }
  return githubApiGet<GitHubRepoSummary>(token, `/repos/${name}`);
}

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startGitHubDeviceFlow(clientId: string): Promise<DeviceFlowStart> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "repo read:user",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(await parseGitHubError(res, text));
  }
  return JSON.parse(text) as DeviceFlowStart;
}

export async function pollGitHubDeviceFlow(
  clientId: string,
  deviceCode: string,
): Promise<{ access_token: string } | { pending: true } | { slowDown: true }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const text = await res.text();
  const data = JSON.parse(text) as {
    access_token?: string;
    error?: string;
  };
  if (data.access_token) {
    return { access_token: data.access_token };
  }
  if (data.error === "authorization_pending") {
    return { pending: true };
  }
  if (data.error === "slow_down") {
    return { slowDown: true };
  }
  throw new Error(data.error ?? `GitHub device flow failed (HTTP ${res.status})`);
}
