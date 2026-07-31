import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "shiftrescue_session";
const SESSION_DAYS = 7;

/**
 * One shared operator login guards the staff directory, the admin console and
 * every mutation. The public schedule stays open because it carries no personal
 * data; staff phone numbers only exist behind this gate.
 *
 * The credentials default to admin / admin123 so the app is usable straight
 * away. They are weak and shared on purpose — this is a demonstration login,
 * not per-user auth, and APP_USERNAME / APP_PASSWORD override both.
 */
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin123";

function username(): string {
  const value = process.env.APP_USERNAME;
  return value && value.trim() !== "" ? value : DEFAULT_USERNAME;
}

function password(): string {
  const value = process.env.APP_PASSWORD;
  return value && value.trim() !== "" ? value : DEFAULT_PASSWORD;
}

function secret(): string {
  return process.env.APP_SESSION_SECRET || password();
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

function matches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate === "") return false;
  return safeEqual(candidate.padEnd(64, "\0").slice(0, 64), expected.padEnd(64, "\0").slice(0, 64));
}

export function checkCredentials(user: unknown, pass: unknown): boolean {
  return matches(user, username()) && matches(pass, password());
}

/** Credentials always exist now that they have defaults. */
export function authConfigured(): boolean {
  return true;
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
