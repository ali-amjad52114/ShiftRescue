"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dayFraction,
  describeRelative,
  formatRange,
  formatTime,
  formatZoneAbbreviation,
} from "@/lib/time/schedule";

interface Shift {
  id: string;
  role: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  location: string;
  pay: string;
  assignedEmployeeId: string | null;
}

interface Person {
  id: string;
  name: string;
  language: string;
  role: string;
  active: boolean;
}

interface Rescue {
  active: boolean;
  shiftId: string | null;
  status: string;
  callingName: string | null;
  callingLanguage: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  confirmedBySms: boolean;
}

interface Schedule {
  canManage: boolean;
  venue: { name: string; location: string; timeZone: string };
  shifts: Shift[];
  people: Person[];
  rescue: Rescue;
}

/** The visible band of the day. Shifts outside it are clamped into view. */
const DAY_START = 7;
const DAY_END = 23;
const BAND = (DAY_END - DAY_START) / 24;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Overlapping shifts have to sit side by side or the day reads as one solid
 * block. Each shift takes the first lane whose previous occupant has already
 * ended, which is the standard interval-graph packing a calendar needs.
 */
function assignLanes<T extends { startsAt: string; endsAt: string }>(
  shifts: T[],
): Array<{ shift: T; lane: number; lanes: number }> {
  const ordered = [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const laneEnds: string[] = [];
  const placed = ordered.map((shift) => {
    let lane = laneEnds.findIndex((end) => end <= shift.startsAt);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(shift.endsAt);
    } else {
      laneEnds[lane] = shift.endsAt;
    }
    return { shift, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  return placed.map((entry) => ({ ...entry, lanes }));
}

function localDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

function mondayOf(date: Date, timeZone: string): Date {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  const offset = Math.max(0, DAY_NAMES.indexOf(weekday));
  const monday = new Date(date);
  monday.setDate(monday.getDate() - offset);
  monday.setHours(12, 0, 0, 0);
  return monday;
}

export function ScheduleView() {
  const [data, setData] = useState<Schedule | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule");
      if (!res.ok) throw new Error(`schedule ${res.status}`);
      setData(await res.json());
    } catch (e) {
      console.error("Could not load the schedule:", e);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 2000);
    const clock = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const timeZone = data?.venue.timeZone ?? "UTC";

  const days = useMemo(() => {
    const monday = mondayOf(new Date(), timeZone);
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      return { key: localDayKey(date.toISOString(), timeZone), date };
    });
  }, [timeZone, weekOffset]);

  const weekShifts = useMemo(() => {
    if (!data) return [];
    const keys = new Set(days.map((d) => d.key));
    return data.shifts.filter((s) => keys.has(localDayKey(s.startsAt, timeZone)));
  }, [data, days, timeZone]);

  const personById = useMemo(() => {
    const map = new Map<string, Person>();
    data?.people.forEach((p) => map.set(p.id, p));
    return map;
  }, [data]);

  if (!data) {
    return (
      <main className="page">
        <p className="empty">Loading the schedule…</p>
      </main>
    );
  }

  const rescue = data.rescue;
  const covered = weekShifts.filter((s) => s.assignedEmployeeId).length;
  const filling = weekShifts.filter((s) => rescue.active && rescue.shiftId === s.id).length;
  const unfilled = weekShifts.length - covered - filling;
  const selected = weekShifts.find((s) => s.id === selectedId) ?? null;

  const findCoverage = async (shiftId: string) => {
    setBusyId(shiftId);
    setError(null);
    try {
      const res = await fetch("/api/coverage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Could not start looking for cover");
      await load();
    } catch {
      setError("Could not start looking for cover");
    } finally {
      setBusyId(null);
    }
  };

  const weekLabel = `${days[0].date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${days[6].date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

  return (
    <main className="page">
      <header className="schedule-head">
        <div>
          <p className="eyebrow">{data.venue.location}</p>
          <h1 className="page-title">{data.venue.name}</h1>
        </div>
        <div className="week-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">
            ‹
          </button>
          <span className="week-label">
            {weekOffset === 0 ? "This week" : weekLabel}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
            ›
          </button>
          {weekOffset !== 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(0)}>
              Today
            </button>
          )}
        </div>
      </header>

      <section className="coverage-strip" aria-label="Coverage summary">
        <div className="coverage-stat">
          <span className="coverage-value">{weekShifts.length}</span>
          <span className="coverage-label">shifts</span>
        </div>
        <div className="coverage-stat">
          <span className="coverage-value">{covered}</span>
          <span className="coverage-label">covered</span>
        </div>
        {filling > 0 && (
          <div className="coverage-stat coverage-stat-filling">
            <span className="coverage-value">{filling}</span>
            <span className="coverage-label">finding cover</span>
          </div>
        )}
        <div className={`coverage-stat${unfilled > 0 ? " coverage-stat-open" : ""}`}>
          <span className="coverage-value">{unfilled}</span>
          <span className="coverage-label">unfilled</span>
        </div>
        <p className="coverage-zone">All times {formatZoneAbbreviation(new Date().toISOString(), timeZone)}</p>
      </section>

      {error && <p className="notice">{error}</p>}

      <section className="calendar" aria-label="Week schedule">
        <div className="calendar-hours" aria-hidden="true">
          {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => (
            <span key={i} className="calendar-hour" style={{ top: `${(i / (DAY_END - DAY_START)) * 100}%` }}>
              {String(DAY_START + i).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        <div className="calendar-grid">
          {days.map(({ key, date }) => {
            const isToday = key === localDayKey(now.toISOString(), timeZone);
            const dayShifts = weekShifts.filter((s) => localDayKey(s.startsAt, timeZone) === key);

            return (
              <div key={key} className={`calendar-day${isToday ? " calendar-day-today" : ""}`}>
                <div className="calendar-day-head">
                  <span className="calendar-day-name">
                    {date.toLocaleDateString("en-GB", { weekday: "short" })}
                  </span>
                  <span className="calendar-day-num">{date.getDate()}</span>
                </div>

                <div className="calendar-slots">
                  {isToday && <CurrentTimeLine now={now} timeZone={timeZone} />}

                  {assignLanes(dayShifts).map(({ shift, lane, lanes }) => {
                    const person = shift.assignedEmployeeId ? personById.get(shift.assignedEmployeeId) : null;
                    const isFilling = rescue.active && rescue.shiftId === shift.id;
                    const top = Math.max(0, (dayFraction(shift.startsAt, timeZone) - DAY_START / 24) / BAND);
                    const bottom = Math.min(1, (dayFraction(shift.endsAt, timeZone) - DAY_START / 24) / BAND);
                    const state = person ? "covered" : isFilling ? "filling" : "open";

                    return (
                      <button
                        key={shift.id}
                        className={`shift-block shift-block-${state}${selectedId === shift.id ? " shift-block-selected" : ""}`}
                        style={(() => {
                          // Equal division makes 3+ overlaps unreadable, so blocks
                          // keep a minimum width and cascade over each other.
                          const width = Math.max(1 / lanes, 0.62);
                          const step = lanes > 1 ? (1 - width) / (lanes - 1) : 0;
                          return {
                            top: `${top * 100}%`,
                            height: `${Math.max(6, (bottom - top) * 100)}%`,
                            left: `calc(${lane * step * 100}% + 2px)`,
                            width: `calc(${width * 100}% - 4px)`,
                            right: "auto",
                            zIndex: lane + 1,
                          };
                        })()}
                        onClick={() => setSelectedId(shift.id === selectedId ? null : shift.id)}
                      >
                        <span className="shift-block-time">{formatTime(shift.startsAt, timeZone)}</span>
                        <span className="shift-block-role">{shift.role}</span>
                        <span className="shift-block-person">
                          {person
                            ? person.name
                            : isFilling
                              ? `Calling ${(rescue.callingName ?? "").split(" ")[0] || "…"}`
                              : "Unfilled"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {selected && (
        <ShiftDetail
          shift={selected}
          person={selected.assignedEmployeeId ? personById.get(selected.assignedEmployeeId) ?? null : null}
          rescue={rescue}
          timeZone={timeZone}
          canManage={data.canManage}
          busy={busyId === selected.id}
          onFindCoverage={() => findCoverage(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

function rescueLabel(rescue: Rescue): string {
  if (rescue.callingName) {
    return rescue.callingLanguage
      ? `Calling ${rescue.callingName} · ${rescue.callingLanguage}`
      : `Calling ${rescue.callingName}`;
  }
  return "Finding cover…";
}

function CurrentTimeLine({ now, timeZone }: { now: Date; timeZone: string }) {
  const position = (dayFraction(now.toISOString(), timeZone) - DAY_START / 24) / BAND;
  if (position < 0 || position > 1) return null;
  return <div className="now-line" style={{ top: `${position * 100}%` }} aria-hidden="true" />;
}

function ShiftDetail({
  shift,
  person,
  rescue,
  timeZone,
  canManage,
  busy,
  onFindCoverage,
  onClose,
}: {
  shift: Shift;
  person: Person | null;
  rescue: Rescue;
  timeZone: string;
  canManage: boolean;
  busy: boolean;
  onFindCoverage: () => void;
  onClose: () => void;
}) {
  const isFilling = rescue.active && rescue.shiftId === shift.id;

  return (
    <section className="detail-panel" aria-label={`${shift.role} shift detail`}>
      <div className="card-head">
        <h2 className="card-title">{shift.role}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="detail-list">
        <div className="detail-row">
          <span className="detail-label">When</span>
          <span className="detail-value">
            {new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(shift.startsAt))}
            {" · "}
            {formatRange(shift.startsAt, shift.endsAt, timeZone)}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Starts</span>
          <span className="detail-value">{describeRelative(shift.startsAt, shift.endsAt)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Location</span>
          <span className="detail-value">{shift.location}</span>
        </div>
        {shift.pay && (
          <div className="detail-row">
            <span className="detail-label">Pay</span>
            <span className="detail-value">{shift.pay}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="detail-label">Assigned</span>
          <span className="detail-value">
            {person ? person.name : isFilling ? rescueLabel(rescue) : "Nobody yet"}
          </span>
        </div>
        {person && rescue.shiftId === shift.id && rescue.confirmedBySms && (
          <div className="detail-row">
            <span className="detail-label">Confirmation</span>
            <span className="detail-value">Text message sent</span>
          </div>
        )}
      </div>

      {!person && canManage && (
        <button className="btn btn-primary" onClick={onFindCoverage} disabled={busy || (rescue.active && rescue.shiftId !== shift.id)}>
          {busy ? "Starting…" : rescue.active && rescue.shiftId !== shift.id ? "Another shift is being covered" : "Find coverage"}
        </button>
      )}

      {isFilling && rescue.timeline.length > 0 && (
        <details className="activity" open>
          <summary className="activity-summary">Activity</summary>
          <ul className="activity-list">
            {rescue.timeline.map((entry) => (
              <li key={entry.id} className="activity-item">
                <time dateTime={entry.timestamp}>{formatTime(entry.timestamp, timeZone)}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
