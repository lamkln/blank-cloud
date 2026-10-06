import fs from "node:fs";
import path from "node:path";

/**
 * Public client id for GitHub device flow (no secret, no callback URL per user).
 * Maintainers: register one OAuth App named "blank-cloud", enable device flow,
 * paste Client ID here or in github-oauth-client-id at repo root / data dir.
 */
export const BUNDLED_GITHUB_OAUTH_CLIENT_ID = "";

let cachedClientId: string | undefined;

function readClientIdFile(filePath: string): string {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (t && !t.startsWith("#")) return t;
    }
    return "";
  } catch {
    return "";
  }
}

/** Copy shipped github-oauth-client-id into data dir on first boot (Docker / install). */
export function ensureGitHubOAuthClientIdFile(): void {
  const dataDir = process.env.BLANK_CLOUD_DATA?.trim() || "/app/data";
  const dest = path.join(dataDir, "github-oauth-client-id");
  if (readClientIdFile(dest)) return;

  const candidates = [
    path.join(process.cwd(), "github-oauth-client-id"),
    path.join(process.cwd(), "github-oauth-client-id.bundled"),
  ];
  for (const src of candidates) {
    const id = readClientIdFile(src);
    if (!id) continue;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, `${id}\n`, { mode: 0o600 });
    cachedClientId = undefined;
    return;
  }
}

/** Resolve OAuth client id: env → data file → repo file → bundled default. */
export function resolveGitHubOAuthClientId(): string {
  if (cachedClientId !== undefined) return cachedClientId;

  const fromEnv = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  if (fromEnv) {
    cachedClientId = fromEnv;
    return fromEnv;
  }

  const dataDir = process.env.BLANK_CLOUD_DATA?.trim() || "/app/data";
  const fromData = readClientIdFile(path.join(dataDir, "github-oauth-client-id"));
  if (fromData) {
    cachedClientId = fromData;
    return fromData;
  }

  const fromRepo = readClientIdFile(path.join(process.cwd(), "github-oauth-client-id"));
  if (fromRepo) {
    cachedClientId = fromRepo;
    return fromRepo;
  }

  cachedClientId = BUNDLED_GITHUB_OAUTH_CLIENT_ID.trim();
  return cachedClientId;
}

export function hasGitHubConnectClientId(): boolean {
  return Boolean(resolveGitHubOAuthClientId());
}
