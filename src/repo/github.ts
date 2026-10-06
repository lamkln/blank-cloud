export interface GitHubUserPublic {
  login: string;
  id: number;
  name: string | null;
  html_url: string;
  avatar_url: string;
  type: string;
}

export function githubNoreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

export function defaultBotDisplayName(user: GitHubUserPublic): string {
  const trimmed = user.name?.trim();
  if (trimmed) return trimmed;
  return user.login;
}

export async function fetchGitHubUser(token: string): Promise<GitHubUserPublic> {
  const t = token.trim();
  if (!t) {
    throw new Error("GitHub token is required");
  }
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blank-cloud-agent",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) detail = j.message;
    } catch {
      /* keep raw */
    }
    throw new Error(`GitHub API error (HTTP ${res.status}): ${detail}`);
  }
  const user = JSON.parse(text) as GitHubUserPublic;
  if (!user.login) {
    throw new Error("Unexpected GitHub API response");
  }
  return user;
}
