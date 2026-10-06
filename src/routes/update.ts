import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { usePerUserGitHubStorage } from "../auth/connect-github.js";
import { getSessionLogin } from "../auth/session.js";
import { loadUser } from "../auth/users.js";
import {
  applyUpdates,
  checkForUpdates,
  getUpdateStatus,
  patchUpdateSettings,
} from "../update/service.js";

const update = new Hono();

function signedIn(c: Context): boolean {
  const login = getSessionLogin(c);
  if (!login) return false;
  return Boolean(loadUser(login)?.gitToken);
}

update.get("/status", (c) => c.json(getUpdateStatus()));

update.post("/check", async (c) => {
  try {
    const status = await checkForUpdates(true);
    return c.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, ...getUpdateStatus() }, 502);
  }
});

const patchSchema = z.object({
  autoCheckEnabled: z.boolean().optional(),
  autoApplyEnabled: z.boolean().optional(),
  checkIntervalHours: z.number().int().min(1).max(168).optional(),
  ref: z.string().min(1).max(120).optional(),
});

update.patch("/settings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json(patchUpdateSettings(parsed.data));
});

update.post("/apply", async (c) => {
  if (usePerUserGitHubStorage() && !signedIn(c)) {
    return c.json({ error: "Sign in with GitHub first" }, 401);
  }
  const result = await applyUpdates("manual");
  if (!result.started && result.message.includes("not enabled")) {
    return c.json({ error: result.message, ...getUpdateStatus() }, 400);
  }
  return c.json({ ...getUpdateStatus(), ...result });
});

export { update as updateRoutes };
