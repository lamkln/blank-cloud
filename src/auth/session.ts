import crypto from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const COOKIE_NAME = "bc_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s) return s;
  return process.env.BLANK_CLOUD_DATA || "blank-cloud-dev-insecure";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(login: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const body = `${login}:${exp}`;
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || sign(body) !== sig) return null;
  const [login, expStr] = body.split(":");
  const exp = Number(expStr);
  if (!login || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return login;
}

export function getSessionLogin(c: Context): string | null {
  const cookie = getCookie(c, COOKIE_NAME);
  return verifySessionToken(cookie);
}

export function setSessionCookie(c: Context, login: string): void {
  setCookie(c, COOKIE_NAME, createSessionToken(login), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function createOAuthState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

const oauthStates = new Map<string, number>();

export function rememberOAuthState(state: string): void {
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
}

export function consumeOAuthState(state: string): boolean {
  const exp = oauthStates.get(state);
  oauthStates.delete(state);
  return Boolean(exp && exp > Date.now());
}
