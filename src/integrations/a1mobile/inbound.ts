// Inbound origination: the worker calls the demo number back after the SMS.
// a1mobile posts the call to the voice webhook set via `point`, and caller ID
// tells us which worker it is -- so the language is chosen without ever asking.

import { normalizeLanguage } from "./messages";
import type { SupportedLanguage } from "./messages";

export interface InboundWorker {
  id: string;
  name: string;
  phone: string;
  language: string;
}

export interface ResolvedCaller {
  worker: InboundWorker;
  language: SupportedLanguage;
}

// Numbers come back in inconsistent formats (+1 555..., 1555..., (555) ...),
// so compare on the last 10 digits rather than trusting the wire format.
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function resolveInboundCaller(
  fromNumber: string,
  workers: InboundWorker[],
): ResolvedCaller | null {
  const caller = normalizePhone(fromNumber);
  if (!caller) return null;

  const worker = workers.find(
    (candidate) =>
      candidate.phone && normalizePhone(candidate.phone) === caller,
  );

  if (!worker) return null;

  return { worker, language: normalizeLanguage(worker.language) };
}

// a1mobile posts a JSON body for the inbound call; the caller field name is not
// documented, so accept the shapes telephony providers commonly use.
export function extractCallerNumber(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const body = payload as Record<string, unknown>;
  const candidates = [body.from, body.From, body.caller, body.caller_number];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }

  return null;
}
