import { Redis } from "@upstash/redis";

let client: Redis | null = null;

/**
 * Vercel serves requests from several function instances, each with its own
 * memory, so anything that must be shared between a webhook and the dashboard
 * lives here rather than in a module-level object.
 *
 * Locally, with no Redis configured, callers fall back to an in-process object:
 * one `next dev` process is the only reader and writer, so it is equivalent. In
 * production that is not true, so a missing configuration fails loudly instead
 * of quietly serving state other instances cannot see.
 */
export function getRedis(): Redis | null {
  if (client) return client;

  // The Vercel/Upstash integration injects KV_REST_API_* rather than the
  // UPSTASH_REDIS_REST_* names Redis.fromEnv() expects, so read both.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.VERCEL === "1") {
      throw new Error(
        "Shared state requires Redis in production. Set KV_REST_API_URL and " +
          "KV_REST_API_TOKEN (vercel integration add upstash/upstash-kv).",
      );
    }
    return null;
  }

  client = new Redis({ url, token });
  return client;
}

export function storageMode(): "redis" | "memory" {
  return getRedis() ? "redis" : "memory";
}
