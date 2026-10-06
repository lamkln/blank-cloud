import { AsyncLocalStorage } from "node:async_hooks";
import type { RepoSettings } from "../settings/store.js";

export interface RequestUserContext {
  login: string;
  githubId: number;
  gitToken: string;
  repo: Pick<
    RepoSettings,
    "remoteUrl" | "branch" | "githubRepoFullName" | "pushOnApprove"
  >;
  workspaceRoot: string;
}

const storage = new AsyncLocalStorage<RequestUserContext>();

export function runWithUserContext<T>(ctx: RequestUserContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestUser(): RequestUserContext | undefined {
  return storage.getStore();
}

export function requireRequestUser(): RequestUserContext {
  const u = getRequestUser();
  if (!u) {
    throw new Error("Sign in with GitHub first");
  }
  return u;
}
