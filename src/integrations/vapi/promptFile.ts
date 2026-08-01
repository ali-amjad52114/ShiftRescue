import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sections parsed out of prompt.md, keyed by their `##` heading.
 * A section that is missing or blank is simply absent, and the caller falls
 * back to its built-in default.
 */
export type PromptSections = Record<string, string>;

/** The only placeholders prompt.md may use. Anything else is left as-is. */
export const PROMPT_PLACEHOLDERS = [
  "workerName",
  "workerId",
  "language",
  "role",
  "date",
  "startTime",
  "endTime",
  "location",
  "pay",
  "maxPay",
  "payHeadroom",
  "venueName",
  // Generated from the lexicon in intent.ts, so the answers the model is told
  // to accept are the same ones the confirmation gate can verify.
  "yesWords",
  "noWords",
  "unsureWords",
] as const;

export type PromptPlaceholder = (typeof PROMPT_PLACEHOLDERS)[number];

const PROMPT_FILE = join(process.cwd(), "src", "integrations", "vapi", "prompt.md");

/**
 * Splits the file on `##` headings. Everything before the first heading is
 * editor documentation and is discarded.
 */
export function parsePromptMarkdown(source: string): PromptSections {
  const sections: PromptSections = {};
  const parts = source.split(/^##[ \t]+(.+?)[ \t]*$/m);

  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const body = (parts[i + 1] || "").trim();
    if (heading && body) sections[heading] = body;
  }

  return sections;
}

let cached: PromptSections | null = null;

/**
 * Reads prompt.md once per process. If the file is unreadable — most likely
 * because it was not traced into a serverless bundle — this returns {} and
 * every caller uses its built-in default, so calls still work.
 */
export function loadPromptSections(): PromptSections {
  if (cached) return cached;

  try {
    cached = parsePromptMarkdown(readFileSync(PROMPT_FILE, "utf8"));
  } catch {
    cached = {};
  }

  return cached;
}

/** Drops the cache so an edit to prompt.md is picked up without a restart. */
export function reloadPromptSections(): PromptSections {
  cached = null;
  return loadPromptSections();
}

/**
 * Replaces {{placeholder}} with backend-supplied values. Unknown placeholders
 * are left untouched so a typo is visible rather than silently blank.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}
