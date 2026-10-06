import type { GitHubUserPublic } from "../repo/github.js";

export function getGitHubOAuthClientSecret(): string {
  return process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || "";
}

export function isGitHubOAuthConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID?.trim() && getGitHubOAuthClientSecret(),
  );
}

export function getPublicBaseUrl(c: { req: { url: string; header: (n: string) => string | undefined } }): string {
  const env = process.env.BLANK_CLOUD_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  const u = new URL(c.req.url);
  return u.origin;
}

export function githubOAuthRedirectUri(c: {
  req: { url: string; header: (n: string) => string | undefined };
}): string {
  return `${getPublicBaseUrl(c)}/auth/github/callback`;
}

export function buildGitHubAuthorizeUrl(redirectUri: string, state: string): string {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!.trim();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(
  code: string,
  redirectUri: string,
): Promise<string> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!.trim();
  const clientSecret = getGitHubOAuthClientSecret();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const text = await res.text();
  const data = JSON.parse(text) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? "GitHub OAuth token exchange failed");
  }
  return data.access_token;
}

export async function fetchGitHubUserWithToken(token: string): Promise<GitHubUserPublic> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blank-cloud-agent",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed (HTTP ${res.status})`);
  }
  return JSON.parse(text) as GitHubUserPublic;
}
