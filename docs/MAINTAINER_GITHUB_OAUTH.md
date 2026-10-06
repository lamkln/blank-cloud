# One-time: ship GitHub Connect for all users

End users should **not** create OAuth apps or edit `.env`.

1. Create GitHub OAuth App **blank-agents** with **Device flow** enabled.
2. Put the **Client ID** (public, starts with `Ov23`) as the only non-comment line in:

   `github-oauth-client-id`

3. Commit and push to `main`. Docker builds embed the id; `install.sh` copies it to `data/`.

Redirect URI / homepage can be `http://localhost:8787` — device flow does not need per-NAS URLs.

Optional: set `GITHUB_OAUTH_CLIENT_SECRET` + `BLANK_CLOUD_PUBLIC_URL` in `.env` for browser redirect login instead of device flow.
