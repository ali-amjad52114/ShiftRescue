/**
 * Shifts are wall-clock events in the venue's local time ("6 PM Friday"), but
 * they have to survive JSON, Redis and a browser in another zone. So everything
 * is stored as an absolute ISO instant plus the zone it was scheduled in, and
 * rendered back in that zone.
 */

export const DEFAULT_TIME_ZONE = process.env.SHIFT_TIME_ZONE || "America/Los_Angeles";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Milliseconds a zone is offset from UTC at a given instant (handles DST). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return asUtc - date.getTime();
}

/** Build the instant at which the given wall-clock time occurs in `timeZone`. */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the DST boundary cases.
  let offset = zoneOffsetMs(new Date(guess), timeZone);
  offset = zoneOffsetMs(new Date(guess - offset), timeZone);
  return new Date(guess - offset);
}

/** Accepts "18:00", "6:00 PM", "6 PM", "6pm". Returns minutes since midnight. */
export function parseClockTime(value: string): { hour: number; minute: number } | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

/** Accepts "2026-07-31" or "July 31" / "31 July" (year inferred, never in the past). */
export function parseDate(value: string, reference: Date, timeZone: string): { year: number; month: number; day: number } | null {
  const text = value.trim().toLowerCase();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const named = text.match(/^([a-z]+)\s+(\d{1,2})$/) || text.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (named) {
    const [a, b] = [named[1], named[2]];
    const monthName = MONTHS.findIndex((m) => m.startsWith(/^\d+$/.test(a) ? b : a));
    const day = Number(/^\d+$/.test(a) ? a : b);
    if (monthName < 0 || !day) return null;

    // No year given: pick the next occurrence rather than one in the past.
    const localNow = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(reference)
      .split("-")
      .map(Number);
    const [nowYear, nowMonth, nowDay] = localNow;
    const year =
      monthName + 1 < nowMonth || (monthName + 1 === nowMonth && day < nowDay) ? nowYear + 1 : nowYear;
    return { year, month: monthName + 1, day };
  }

  if (text === "today" || text === "tonight") {
    const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(reference)
      .split("-")
      .map(Number);
    return { year, month, day };
  }

  return null;
}

export interface ResolvedWindow {
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/**
 * Turn whatever VoiceOS extracted into an absolute window. Accepts ISO instants
 * directly, or a spoken-style date plus start/end times.
 */
export function resolveShiftWindow(input: {
  date?: string;
  startTime?: string;
  endTime?: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  now?: Date;
}): ResolvedWindow {
  const timeZone = input.timeZone || DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();

  if (input.startsAt && input.endsAt) {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("startsAt and endsAt must be valid ISO timestamps");
    }
    if (end <= start) throw new Error("endsAt must be after startsAt");
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), timeZone };
  }

  const date = parseDate(input.date ?? "today", now, timeZone);
  const start = input.startTime ? parseClockTime(input.startTime) : null;
  const end = input.endTime ? parseClockTime(input.endTime) : null;

  if (!date) throw new Error(`Could not understand the shift date: "${input.date}"`);
  if (!start) throw new Error(`Could not understand the start time: "${input.startTime}"`);
  if (!end) throw new Error(`Could not understand the end time: "${input.endTime}"`);

  const startsAt = zonedTimeToInstant(date.year, date.month, date.day, start.hour, start.minute, timeZone);
  let endsAt = zonedTimeToInstant(date.year, date.month, date.day, end.hour, end.minute, timeZone);
  // An overnight shift ends the following day.
  if (endsAt <= startsAt) {
    endsAt = zonedTimeToInstant(date.year, date.month, date.day + 1, end.hour, end.minute, timeZone);
  }

  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timeZone };
}

/* ------------------------------------------------------------------ display */

export function formatDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/**
 * The forms people say out loud, used both by the phone assistant and by the
 * confirmation SMS: "Friday, July 31" and "6:00 PM", in the venue's own zone.
 */
export function formatSpokenDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatSpokenTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  return `${formatTime(startsAt, timeZone)}–${formatTime(endsAt, timeZone)}`;
}

export function formatZoneAbbreviation(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(
    new Date(iso),
  );
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** "in 2 hr 10 min" / "started 20 min ago" / "ended 3 hr ago" */
export function describeRelative(startsAt: string, endsAt: string, now: Date = new Date()): string {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const ms = now.getTime();

  if (ms >= start && ms <= end) return `in progress · ends ${humanise(end - ms)} from now`;
  if (ms < start) return `starts in ${humanise(start - ms)}`;
  return `ended ${humanise(ms - end)} ago`;
}

function humanise(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Fraction (0–1) of the given local day that an instant sits at, for calendar positioning. */
export function dayFraction(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (at("hour") % 24) / 24 + at("minute") / 1440;
}
