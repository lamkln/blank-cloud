import { DEFAULT_UPDATE_REF, UPSTREAM_REPO } from "./meta.js";

export type RemoteCommitInfo = {
  sha: string;
  message: string;
  date: string;
  htmlUrl: string;
};

export async function fetchRemoteCommit(ref = DEFAULT_UPDATE_REF): Promise<RemoteCommitInfo> {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "blank-cloud-auto-update",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) detail = j.message;
    } catch {
      /* keep slice */
    }
    throw new Error(`GitHub API HTTP ${res.status}: ${detail}`);
  }
  const data = JSON.parse(text) as {
    sha: string;
    commit?: { message?: string; author?: { date?: string } };
    html_url?: string;
  };
  return {
    sha: data.sha,
    message: (data.commit?.message ?? "").split("\n")[0] ?? "",
    date: data.commit?.author?.date ?? "",
    htmlUrl: data.html_url ?? `https://github.com/${UPSTREAM_REPO}/commit/${data.sha}`,
  };
}
