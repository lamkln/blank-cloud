import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../settings/store.js";

export interface UserRepoConfig {
  remoteUrl: string;
  branch: string;
  githubRepoFullName: string;
  pushOnApprove: boolean;
}

export interface UserRecord {
  githubId: number;
  login: string;
  gitToken: string;
  repo: UserRepoConfig;
  updatedAt: string;
}

function usersDir(): string {
  return path.join(getDataDir(), "users");
}

function userPath(login: string): string {
  const safe = login.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(usersDir(), `${safe}.json`);
}

export function ensureUsersDir(): void {
  fs.mkdirSync(usersDir(), { recursive: true, mode: 0o700 });
}

export function loadUser(login: string): UserRecord | null {
  ensureUsersDir();
  const file = userPath(login);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as UserRecord;
  } catch {
    return null;
  }
}

export function saveUser(record: UserRecord): UserRecord {
  ensureUsersDir();
  const next = { ...record, updatedAt: new Date().toISOString() };
  fs.writeFileSync(userPath(record.login), `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  return next;
}

export type UserRecordPatch = {
  githubId?: number;
  gitToken?: string;
  repo?: Partial<UserRepoConfig>;
  updatedAt?: string;
};

export function updateUser(login: string, patch: UserRecordPatch): UserRecord {
  const current =
    loadUser(login) ??
    ({
      githubId: 0,
      login,
      gitToken: "",
      repo: {
        remoteUrl: "",
        branch: "main",
        githubRepoFullName: "",
        pushOnApprove: false,
      },
      updatedAt: new Date().toISOString(),
    } satisfies UserRecord);
  const next: UserRecord = {
    ...current,
    ...patch,
    login: current.login,
    repo: { ...current.repo, ...(patch.repo ?? {}) },
  };
  return saveUser(next);
}

export function getUserWorkspaceRoot(login: string): string {
  const safe = login.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getDataDir(), "workspaces", safe);
}

export function ensureUserWorkspace(login: string): string {
  const root = getUserWorkspaceRoot(login);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
