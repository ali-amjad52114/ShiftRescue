import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "shiftrescue_session";
const SESSION_DAYS = 7;

/**
 * A single shared password guards the staff directory, the admin console and
 * every mutation. The public schedule stays open because it carries no personal
 * data; staff phone numbers only exist behind this gate.
 *
 * This is deliberately one shared credential rather than user accounts — there
 * is one operator. It is not a substitute for per-user auth if this ever grows
 * real tenants.
 */
function password(): string | null {
  const value = process.env.APP_PASSWORD;
  return value && value.trim() !== "" ? value : null;
}

function secret(): string {
  return process.env.APP_SESSION_SECRET || password() || "shiftrescue-dev-secret";
}

function sign(expiry: number): string {
  return createHmac("sha256", secret()).update(String(expiry)).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueToken(): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expiry = Date.now() + maxAge * 1000;
  return { value: `${expiry}.${sign(expiry)}`, maxAge };
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expiryPart, signature] = token.split(".");
  const expiry = Number(expiryPart);
  if (!expiry || !signature || Date.now() > expiry) return false;
  return safeEqual(signature, sign(expiry));
}

export function checkPassword(candidate: unknown): boolean {
  const expected = password();
  if (!expected) return false;
  if (typeof candidate !== "string" || candidate === "") return false;
  return safeEqual(candidate.padEnd(64, "\0").slice(0, 64), expected.padEnd(64, "\0").slice(0, 64));
}

/** True when a password is configured at all. */
export function authConfigured(): boolean {
  return password() !== null;
}

export async function isAuthenticated(): Promise<boolean> {
  // With no password configured, local development stays usable; a deployment
  // without one refuses rather than silently exposing the staff directory.
  if (!authConfigured()) return process.env.VERCEL !== "1";
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
