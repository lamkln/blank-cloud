import { Hono } from "hono";
import {
  buildGitHubAuthorizeUrl,
  exchangeGitHubCode,
  fetchGitHubUserWithToken,
  githubOAuthRedirectUri,
  isGitHubOAuthConfigured,
} from "../auth/github-oauth.js";
import { authStatus } from "../auth/middleware.js";
import {
  clearSessionCookie,
  consumeOAuthState,
  createOAuthState,
  rememberOAuthState,
  setSessionCookie,
} from "../auth/session.js";
import { updateUser } from "../auth/users.js";
import { githubNoreplyEmail } from "../repo/github.js";

const auth = new Hono();

auth.get("/me", (c) => c.json(authStatus(c)));

auth.get("/github/login", (c) => {
  if (!isGitHubOAuthConfigured()) {
    return c.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and BLANK_CLOUD_PUBLIC_URL on the server.",
      },
      501,
    );
  }
  const state = createOAuthState();
  rememberOAuthState(state);
  const redirectUri = githubOAuthRedirectUri(c);
  const url = buildGitHubAuthorizeUrl(redirectUri, state);
  return c.redirect(url, 302);
});

auth.get("/github/callback", async (c) => {
  if (!isGitHubOAuthConfigured()) {
    return c.text("OAuth not configured", 501);
  }
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code || !consumeOAuthState(state)) {
    return c.text("Invalid OAuth state", 400);
  }
  try {
    const redirectUri = githubOAuthRedirectUri(c);
    const token = await exchangeGitHubCode(code, redirectUri);
    const ghUser = await fetchGitHubUserWithToken(token);
    updateUser(ghUser.login, { githubId: ghUser.id, gitToken: token });
    setSessionCookie(c, ghUser.login);
    return c.redirect("/?github=connected", 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.text(`GitHub sign-in failed: ${msg}`, 400);
  }
});

auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

export { auth as authRoutes };
