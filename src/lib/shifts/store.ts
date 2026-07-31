import { getRedis } from "../redis";
import { listEmployees } from "../employees/store";
import { DEFAULT_TIME_ZONE, zonedTimeToInstant } from "../time/schedule";

const SHIFTS_KEY = "shiftrescue:shifts";
const SEED_STAMP_KEY = "shiftrescue:shifts:seeded-week";

export interface ScheduledShift {
  id: string;
  role: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  location: string;
  pay: string;
  assignedEmployeeId: string | null;
}

export const VENUE_NAME = process.env.VENUE_NAME || "Harbour Street Kitchen";
export const VENUE_LOCATION = process.env.VENUE_LOCATION || "Downtown San Francisco";

/** Local Y/M/D for an instant in the venue's zone. */
function localParts(date: Date, timeZone: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return { year, month, day };
}

/** Monday of the week containing `date`, in the venue's zone. */
function weekStart(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const offset = Math.max(0, order.indexOf(weekday));
  const { year, month, day } = localParts(date, timeZone);
  return { year, month, day: day - offset };
}

/** Per-weekday rota (0 = Monday). A real week is not the same shape every day. */
const WEEK_PATTERN: Array<Array<{ role: string; start: number; end: number; pay: string }>> = [
  [ // Mon — quiet
    { role: "Kitchen Assistant", start: 9, end: 16, pay: "$22 per hour" },
    { role: "Server", start: 11, end: 19, pay: "$21 per hour" },
  ],
  [ // Tue
    { role: "Kitchen Assistant", start: 9, end: 16, pay: "$22 per hour" },
    { role: "Server", start: 11, end: 19, pay: "$21 per hour" },
  ],
  [ // Wed
    { role: "Kitchen Assistant", start: 8, end: 16, pay: "$22 per hour" },
    { role: "Server", start: 11, end: 19, pay: "$21 per hour" },
    { role: "Kitchen Assistant", start: 18, end: 22, pay: "$24 per hour" },
  ],
  [ // Thu
    { role: "Kitchen Assistant", start: 8, end: 16, pay: "$22 per hour" },
    { role: "Server", start: 12, end: 20, pay: "$21 per hour" },
    { role: "Kitchen Assistant", start: 18, end: 23, pay: "$24 per hour" },
  ],
  [ // Fri — busiest
    { role: "Kitchen Assistant", start: 8, end: 16, pay: "$22 per hour" },
    { role: "Server", start: 11, end: 19, pay: "$21 per hour" },
    { role: "Kitchen Assistant", start: 18, end: 23, pay: "$24 per hour" },
    { role: "Server", start: 17, end: 23, pay: "$23 per hour" },
  ],
  [ // Sat
    { role: "Kitchen Assistant", start: 9, end: 17, pay: "$22 per hour" },
    { role: "Server", start: 12, end: 20, pay: "$21 per hour" },
    { role: "Kitchen Assistant", start: 18, end: 23, pay: "$24 per hour" },
  ],
  [ // Sun — brunch only
    { role: "Kitchen Assistant", start: 10, end: 17, pay: "$22 per hour" },
    { role: "Server", start: 10, end: 18, pay: "$21 per hour" },
  ],
];

/**
 * Starter schedule for a new environment, generated relative to today so the
 * calendar is always the current week rather than a stale hardcoded date.
 *
 * These are ordinary editable records once written — the store is the source of
 * truth. One future evening shift is deliberately left unassigned, because an
 * uncovered shift is the situation this product exists to resolve.
 */
async function seedWeek(now: Date, timeZone: string): Promise<ScheduledShift[]> {
  const employees = (await listEmployees()).filter((e) => e.active);
  const monday = weekStart(now, timeZone);
  const shifts: ScheduledShift[] = [];

  let cursor = 0;
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    for (const pattern of WEEK_PATTERN[dayOffset]) {
      const day = monday.day + dayOffset;
      const startsAt = zonedTimeToInstant(monday.year, monday.month, day, pattern.start, 0, timeZone);
      const endsAt = zonedTimeToInstant(monday.year, monday.month, day, pattern.end, 0, timeZone);
      const assignee = employees.length > 0 ? employees[cursor % employees.length] : null;
      cursor += 1;

      shifts.push({
        id: `shift_${startsAt.getTime()}_${pattern.role.toLowerCase().replace(/\W+/g, "-")}`,
        role: pattern.role,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone,
        location: VENUE_LOCATION,
        pay: pattern.pay,
        assignedEmployeeId: assignee ? assignee.id : null,
      });
    }
  }

  // Leave the next upcoming evening shift open — that is the gap to be rescued.
  const gap = shifts.find((s) => new Date(s.startsAt).getTime() > now.getTime() + 60 * 60 * 1000);
  if (gap) gap.assignedEmployeeId = null;

  return shifts;
}

const globalForShifts = globalThis as unknown as { shifts: ScheduledShift[] | undefined };

export async function listShifts(now: Date = new Date()): Promise<ScheduledShift[]> {
  const timeZone = DEFAULT_TIME_ZONE;
  const redis = getRedis();
  const stamp = weekStartStamp(now, timeZone);

  if (!redis) {
    if (!globalForShifts.shifts) globalForShifts.shifts = await seedWeek(now, timeZone);
    return sorted(globalForShifts.shifts);
  }

  const [stored, storedStamp] = await Promise.all([
    redis.get<ScheduledShift[]>(SHIFTS_KEY),
    redis.get<string>(SEED_STAMP_KEY),
  ]);

  // Re-seed when the calendar week rolls over, so the schedule never looks
  // abandoned. Anything the user added stays untouched.
  if (stored && stored.length > 0 && storedStamp === stamp) return sorted(stored);

  const seeded = await seedWeek(now, timeZone);
  const merged = stored && stored.length > 0 ? mergeKeepingEdits(seeded, stored) : seeded;
  await Promise.all([redis.set(SHIFTS_KEY, merged), redis.set(SEED_STAMP_KEY, stamp)]);
  return sorted(merged);
}

function weekStartStamp(now: Date, timeZone: string): string {
  const { year, month, day } = weekStart(now, timeZone);
  return `${year}-${month}-${day}`;
}

/** Keep shifts the user created or edited when a new week is seeded. */
function mergeKeepingEdits(seeded: ScheduledShift[], existing: ScheduledShift[]): ScheduledShift[] {
  const seededIds = new Set(seeded.map((s) => s.id));
  const userShifts = existing.filter((s) => !seededIds.has(s.id) && !s.id.startsWith("shift_"));
  return [...seeded, ...userShifts];
}

function sorted(shifts: ScheduledShift[]): ScheduledShift[] {
  return [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function save(shifts: ScheduledShift[]): Promise<ScheduledShift[]> {
  const redis = getRedis();
  if (!redis) {
    globalForShifts.shifts = shifts;
    return shifts;
  }
  await redis.set(SHIFTS_KEY, shifts);
  return shifts;
}

export async function getShift(id: string): Promise<ScheduledShift | null> {
  return (await listShifts()).find((s) => s.id === id) ?? null;
}

export interface ShiftInput {
  role?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  pay?: string;
  assignedEmployeeId?: string | null;
}

export async function createShift(input: ShiftInput): Promise<ScheduledShift> {
  const required = ["role", "startsAt", "endsAt"] as const;
  const missing = required.filter((f) => typeof input[f] !== "string" || !String(input[f]).trim());
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
  if (new Date(input.endsAt!) <= new Date(input.startsAt!)) throw new Error("endsAt must be after startsAt");

  const shift: ScheduledShift = {
    id: `sh_${Math.random().toString(36).slice(2, 10)}`,
    role: input.role!.trim(),
    startsAt: new Date(input.startsAt!).toISOString(),
    endsAt: new Date(input.endsAt!).toISOString(),
    timeZone: DEFAULT_TIME_ZONE,
    location: input.location?.trim() || VENUE_LOCATION,
    pay: input.pay?.trim() || "",
    assignedEmployeeId: input.assignedEmployeeId ?? null,
  };

  await save([...(await listShifts()), shift]);
  return shift;
}

export async function updateShift(id: string, input: ShiftInput): Promise<ScheduledShift> {
  const shifts = await listShifts();
  const index = shifts.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`No shift with id ${id}`);

  const updated: ScheduledShift = {
    ...shifts[index],
    ...(input.role !== undefined ? { role: input.role.trim() } : {}),
    ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt).toISOString() } : {}),
    ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt).toISOString() } : {}),
    ...(input.location !== undefined ? { location: input.location.trim() } : {}),
    ...(input.pay !== undefined ? { pay: input.pay.trim() } : {}),
    ...(input.assignedEmployeeId !== undefined ? { assignedEmployeeId: input.assignedEmployeeId } : {}),
  };

  if (new Date(updated.endsAt) <= new Date(updated.startsAt)) throw new Error("endsAt must be after startsAt");

  const next = [...shifts];
  next[index] = updated;
  await save(next);
  return updated;
}

export async function deleteShift(id: string): Promise<void> {
  const shifts = await listShifts();
  if (!shifts.some((s) => s.id === id)) throw new Error(`No shift with id ${id}`);
  await save(shifts.filter((s) => s.id !== id));
}

/** Called when a rescue succeeds, so the calendar reflects the new coverage. */
export async function assignShift(id: string, employeeId: string): Promise<ScheduledShift | null> {
  const shifts = await listShifts();
  if (!shifts.some((s) => s.id === id)) return null;
  return updateShift(id, { assignedEmployeeId: employeeId });
}

export async function resetShifts(): Promise<ScheduledShift[]> {
  const redis = getRedis();
  const seeded = await seedWeek(new Date(), DEFAULT_TIME_ZONE);
  if (redis) await redis.set(SEED_STAMP_KEY, weekStartStamp(new Date(), DEFAULT_TIME_ZONE));
  return save(seeded);
}
