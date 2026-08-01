// Vapi call log.
//
// One append-only record per call of everything that crossed the boundary: the
// exact prompt and variables handed to the assistant, every final transcript
// line, the decision tool it fired, and how the call ended. When a call goes
// wrong the first question is always "what did we actually send it", and until
// now the answer lived only in Vapi's dashboard.
//
// Stored in Redis so it survives across serverless instances, and mirrored to
// logs/vapi-calls.jsonl in local development where a file is easier to grep.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getRedis } from "../redis";

const LOG_KEY = "shiftrescue:call-log";

/** Calls retained. Beyond this the oldest are dropped. */
const MAX_CALLS = 50;
/** Transcript lines retained per call. */
const MAX_LINES = 200;

export type CallLogEventType =
  | "call.requested"
  | "call.placed"
  | "call.failed"
  | "transcript"
  | "decision"
  /** A decision the confirmation gate refused, with what the worker had said. */
  | "decision.challenged"
  | "call.ended";

export interface CallLogEvent {
  type: CallLogEventType;
  at: string;
  /** Free-form detail, shaped by the event type. Never contains a phone number. */
  detail?: Record<string, unknown>;
}

/** Exactly what the assistant was given for this call. */
export interface AssistantInput {
  assistantId?: string;
  firstMessage: string;
  systemPrompt: string;
  variableValues: Record<string, string>;
  model?: string;
  toolNames: string[];
}

export interface CallLogEntry {
  attemptId: string;
  callId?: string;
  workerId: string;
  workerName?: string;
  language?: string;
  shiftId?: string;
  startedAt: string;
  endedAt?: string;
  endedReason?: string;
  decision?: string;
  /** Rate the worker actually agreed to, when it differs from the posted rate. */
  agreedPay?: string;
  assistantInput?: AssistantInput;
  transcript: Array<{ at: string; speaker: "agent" | "worker"; text: string }>;
  events: CallLogEvent[];
}

const globalForCallLog = globalThis as unknown as { callLog: CallLogEntry[] | undefined };

async function readAll(): Promise<CallLogEntry[]> {
  const redis = getRedis();
  if (!redis) return globalForCallLog.callLog ?? [];
  return (await redis.get<CallLogEntry[]>(LOG_KEY)) ?? [];
}

async function writeAll(entries: CallLogEntry[]): Promise<void> {
  const trimmed = entries.slice(-MAX_CALLS);
  const redis = getRedis();
  if (!redis) {
    globalForCallLog.callLog = trimmed;
    return;
  }
  await redis.set(LOG_KEY, trimmed);
}

/**
 * Mirror to disk in local development only. On Vercel the filesystem is
 * read-only and ephemeral, so a failure here is expected and ignored — Redis is
 * the real store and logging must never break a live call.
 */
async function mirrorToFile(entry: CallLogEntry, event: CallLogEvent): Promise<void> {
  if (process.env.VERCEL === "1" || process.env.CALL_LOG_FILE === "off") return;

  try {
    const dir = join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    await appendFile(
      join(dir, "vapi-calls.jsonl"),
      `${JSON.stringify({ attemptId: entry.attemptId, callId: entry.callId, ...event })}\n`,
      "utf8",
    );
  } catch {
    // Logging is never worth failing a call over.
  }
}

function blank(attemptId: string, workerId: string): CallLogEntry {
  return {
    attemptId,
    workerId,
    startedAt: new Date().toISOString(),
    transcript: [],
    events: [],
  };
}

/**
 * Records one event against a call, creating the entry if this is the first
 * thing heard about it. `patch` updates the entry's own fields; `event` is
 * appended to its history.
 */
export async function recordCallEvent(input: {
  attemptId: string;
  workerId: string;
  event: CallLogEvent;
  patch?: Partial<Omit<CallLogEntry, "attemptId" | "transcript" | "events">>;
}): Promise<void> {
  try {
    const entries = await readAll();
    const index = entries.findIndex((e) => e.attemptId === input.attemptId);
    const entry = index >= 0 ? { ...entries[index] } : blank(input.attemptId, input.workerId);

    Object.assign(entry, input.patch ?? {});
    entry.events = [...entry.events, input.event];

    const next = [...entries];
    if (index >= 0) next[index] = entry;
    else next.push(entry);

    await writeAll(next);
    await mirrorToFile(entry, input.event);
  } catch {
    // Same rule as the file mirror: never break a call to write a log line.
  }
}

/**
 * Appends a transcript line to whichever call is identified by callId, falling
 * back to the most recent open call. Vapi's transcript messages carry the call
 * id but not our attempt id.
 */
export async function recordTranscriptLine(input: {
  callId?: string;
  workerId?: string;
  speaker: "agent" | "worker";
  text: string;
}): Promise<void> {
  const text = input.text?.trim();
  if (!text) return;

  try {
    const entries = await readAll();
    const index = findOpenCall(entries, input.callId, input.workerId);
    if (index < 0) return;

    const entry = { ...entries[index] };
    entry.transcript = [
      ...entry.transcript,
      { at: new Date().toISOString(), speaker: input.speaker, text },
    ].slice(-MAX_LINES);

    const next = [...entries];
    next[index] = entry;
    await writeAll(next);
    await mirrorToFile(entry, {
      type: "transcript",
      at: new Date().toISOString(),
      detail: { speaker: input.speaker, text },
    });
  } catch {
    // Never break a call to write a log line.
  }
}

function findOpenCall(entries: CallLogEntry[], callId?: string, workerId?: string): number {
  if (callId) {
    const byCall = entries.findIndex((e) => e.callId === callId);
    if (byCall >= 0) return byCall;
  }
  // Search backwards: the newest matching call that has not ended yet.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].endedAt) continue;
    if (workerId && entries[i].workerId !== workerId) continue;
    return i;
  }
  return -1;
}

/** Marks a call finished, so later transcript lines cannot attach to it. */
export async function closeCallLog(input: {
  callId?: string;
  attemptId?: string;
  endedReason?: string;
}): Promise<void> {
  try {
    const entries = await readAll();
    const index = input.attemptId
      ? entries.findIndex((e) => e.attemptId === input.attemptId)
      : findOpenCall(entries, input.callId);
    if (index < 0) return;

    const entry = {
      ...entries[index],
      endedAt: new Date().toISOString(),
      endedReason: input.endedReason ?? entries[index].endedReason,
    };
    entry.events = [
      ...entry.events,
      { type: "call.ended", at: entry.endedAt!, detail: { endedReason: entry.endedReason } },
    ];

    const next = [...entries];
    next[index] = entry;
    await writeAll(next);
    await mirrorToFile(entry, entry.events[entry.events.length - 1]);
  } catch {
    // Never break a call to write a log line.
  }
}

/** Newest first, for the ops console. */
export async function listCallLogs(limit = 20): Promise<CallLogEntry[]> {
  return (await readAll()).slice(-limit).reverse();
}

export async function getCallLog(attemptId: string): Promise<CallLogEntry | null> {
  return (await readAll()).find((e) => e.attemptId === attemptId) ?? null;
}

export async function clearCallLogs(): Promise<void> {
  await writeAll([]);
}
