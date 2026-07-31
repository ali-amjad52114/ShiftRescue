"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShiftForm, type ShiftDraft } from "./ShiftForm";
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
  transcript: Array<{ id: string; speaker: "agent" | "worker"; text: string; timestamp: string }>;
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

/**
 * The seven calendar days of the venue's week.
 *
 * Both the weekday and the date must be read in the venue's zone: taking the
 * weekday there but subtracting days from the *local* date puts the week a day
 * out whenever the two disagree, which is most of the evening in California.
 * Dates are handled as UTC-midnight calendar values, never instants.
 */
function weekDays(timeZone: string, weekOffset: number): Array<{ key: string; weekday: string; dayNumber: number }> {
  const now = new Date();
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);

  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(now);
  const offset = Math.max(0, DAY_NAMES.indexOf(weekday));

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, day - offset + weekOffset * 7 + i));
    return {
      key: d.toISOString().slice(0, 10),
      weekday: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(d),
      dayNumber: d.getUTCDate(),
    };
  });
}

export function ScheduleView() {
  const [data, setData] = useState<Schedule | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [roleFilter, setRoleFilter] = useState("all");
  const [editorFor, setEditorFor] = useState<ShiftDraft | null | undefined>(undefined);
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

  const days = useMemo(() => weekDays(timeZone, weekOffset), [timeZone, weekOffset]);

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
  const roles = Array.from(new Set(data.shifts.map((s) => s.role))).sort();
  // "All roles" is the unified view; picking a type narrows every part of the
  // screen at once — calendar, counts and the attention banner.
  const visibleShifts = roleFilter === "all" ? weekShifts : weekShifts.filter((s) => s.role === roleFilter);
  const covered = visibleShifts.filter((s) => s.assignedEmployeeId).length;
  const filling = visibleShifts.filter((s) => rescue.active && rescue.shiftId === s.id).length;
  const unfilled = visibleShifts.length - covered - filling;
  const selected = visibleShifts.find((s) => s.id === selectedId) ?? null;

  // Every slot that still has nobody on it. Surfaced, never acted on: a rescue
  // only ever starts from an explicit click here or a VoiceOS command.
  const problemSlots = visibleShifts
    .filter((s) => !s.assignedEmployeeId && !(rescue.active && rescue.shiftId === s.id))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

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

  const assignShift = async (shiftId: string, assignedEmployeeId: string | null) => {
    setBusyId(shiftId);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignedEmployeeId }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Could not update shift assignment");
      await load();
    } catch {
      setError("Could not update shift assignment");
    } finally {
      setBusyId(null);
    }
  };

  const markUnfulfilledAndRescue = async (shiftId: string) => {
    setBusyId(shiftId);
    setError(null);
    try {
      // Unassign first so it reflects as unassigned/open in calendar
      await fetch(`/api/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignedEmployeeId: null }),
      });
      // Then launch rescue workflow
      await findCoverage(shiftId);
    } catch {
      setError("Could not unassign and start rescue");
    } finally {
      setBusyId(null);
    }
  };

  const shortDay = (key: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${key}T00:00:00Z`));
  const weekLabel = `${shortDay(days[0].key)} – ${shortDay(days[6].key)}`;

  return (
    <main className="page">
      <header className="schedule-head">
        <div>
          <p className="eyebrow">{data.venue.location}</p>
          <h1 className="page-title">{data.venue.name}</h1>
        </div>
        <div className="week-nav">
          <label className="role-filter">
            <span className="visually-hidden">Filter by role</span>
            <select className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
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
          {data.canManage && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() =>
                setEditorFor({
                  role: roles[0] || "Server",
                  startsAt: new Date(now.getTime() + 2 * 3600 * 1000).toISOString(),
                  endsAt: new Date(now.getTime() + 10 * 3600 * 1000).toISOString(),
                  pay: "$22 per hour",
                  assignedEmployeeId: null,
                })
              }
            >
              + Shift
            </button>
          )}
        </div>
      </header>

      <section className="summary" aria-label="Coverage summary">
        <div className="summary-counts">
          <span className="summary-count">
            <strong>{visibleShifts.length}</strong> shifts
          </span>
          <span className="summary-count">
            <strong>{covered}</strong> covered
          </span>
          {filling > 0 && (
            <span className="summary-count summary-count-filling">
              <strong>{filling}</strong> finding cover
            </span>
          )}
          <span className={`summary-count${unfilled > 0 ? " summary-count-open" : ""}`}>
            <strong>{unfilled}</strong> unfilled
          </span>
          <span className="summary-zone">
            {formatZoneAbbreviation(new Date().toISOString(), timeZone)}
          </span>
        </div>

        {problemSlots.length > 0 && (
          <ul className="summary-gaps">
            {problemSlots.map((shift) => (
              <li key={shift.id} className="summary-gap">
                <button className="summary-gap-slot" onClick={() => setSelectedId(shift.id)}>
                  <span className="summary-gap-tag">Unfilled</span>
                  <span className="summary-gap-when">
                    {new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(shift.startsAt))}
                    {" · "}
                    {formatRange(shift.startsAt, shift.endsAt, timeZone)}
                  </span>
                  <span className="summary-gap-role">{shift.role}</span>
                </button>
                {data.canManage && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busyId === shift.id || rescue.active}
                    onClick={() => findCoverage(shift.id)}
                  >
                    {busyId === shift.id ? "Starting…" : rescue.active ? "Busy" : "Find coverage"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="notice">{error}</p>}

      {editorFor !== undefined && (
        <div className="shift-form-anchor">
        <ShiftForm
          shift={editorFor}
          people={data.people}
          timeZone={timeZone}
          onSaved={() => {
            setEditorFor(undefined);
            load();
          }}
          onCancel={() => setEditorFor(undefined)}
        />
        </div>
      )}

      {/* Who is being called, and how far the run has got, is the dock's job at
          the bottom of the screen. This panel is only the call itself, so the
          same sentence is not repeated in two places. */}
      {rescue.active && rescue.timeline.length > 0 && (
        <section className="live" aria-label="Live call">
          <div className="live-head">
            <span className="live-shift">
              {(() => {
                const target = data.shifts.find((s) => s.id === rescue.shiftId);
                if (!target) return "Finding cover";
                return `Covering ${target.role} · ${new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(target.startsAt))} ${formatRange(target.startsAt, target.endsAt, timeZone)}`;
              })()}
            </span>
          </div>

          <div className="live-columns">
            <div className="live-column">
              <p className="live-column-label">Conversation</p>
              {(rescue.transcript ?? []).length === 0 ? (
                <p className="live-waiting">Waiting for the first words of the call…</p>
              ) : (
                <ul className="transcript">
                  {(rescue.transcript ?? []).slice(-8).map((line) => (
                    <li key={line.id} className={`transcript-line transcript-${line.speaker}`}>
                      <span className="transcript-who">{line.speaker === "agent" ? "Agent" : "Worker"}</span>
                      <span className="transcript-text">{line.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="live-column live-column-narrow">
              <p className="live-column-label">Activity</p>
              <ul className="live-feed">
                {rescue.timeline.slice(-6).map((entry, index, all) => (
                  <li key={entry.id} className={`live-event${index === all.length - 1 ? " live-event-latest" : ""}`}>
                    <time dateTime={entry.timestamp}>{formatTime(entry.timestamp, timeZone)}</time>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="calendar" aria-label="Week schedule">
        <div className="calendar-hours" aria-hidden="true">
          {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => (
            <span key={i} className="calendar-hour" style={{ top: `${(i / (DAY_END - DAY_START)) * 100}%` }}>
              {String(DAY_START + i).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        <div className="calendar-grid">
          {days.map(({ key, weekday, dayNumber }) => {
            const isToday = key === localDayKey(now.toISOString(), timeZone);
            const dayShifts = visibleShifts.filter((s) => localDayKey(s.startsAt, timeZone) === key);

            return (
              <div key={key} className={`calendar-day${isToday ? " calendar-day-today" : ""}`}>
                <div className="calendar-day-head">
                  <span className="calendar-day-name">{weekday}</span>
                  <span className="calendar-day-num">{dayNumber}</span>
                </div>

                <div className="calendar-slots">
                  {isToday && <CurrentTimeLine now={now} timeZone={timeZone} />}

                  {assignLanes(dayShifts).map(({ shift, lane, lanes }) => {
                    const person = shift.assignedEmployeeId ? personById.get(shift.assignedEmployeeId) : null;
                    const isFilling = rescue.active && rescue.shiftId === shift.id;
                    const top = Math.max(0, (dayFraction(shift.startsAt, timeZone) - DAY_START / 24) / BAND);
                    const bottom = Math.min(1, (dayFraction(shift.endsAt, timeZone) - DAY_START / 24) / BAND);
                    const state = person ? "covered" : isFilling ? "filling" : "open";
                    const roleClass = getRoleClass(shift.role);

                    return (
                      <button
                        key={shift.id}
                        className={`shift-block shift-block-${state} shift-block-role-${roleClass}${selectedId === shift.id ? " shift-block-selected" : ""}`}
                        style={(() => {
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

      {rescue.active && <ProgressDock rescue={rescue} />}

      {selected && (
        <ShiftDetail
          shift={selected}
          person={selected.assignedEmployeeId ? personById.get(selected.assignedEmployeeId) ?? null : null}
          people={data.people}
          rescue={rescue}
          timeZone={timeZone}
          canManage={data.canManage}
          busy={busyId === selected.id}
          onAssign={(empId) => assignShift(selected.id, empId)}
          onFindCoverage={() => findCoverage(selected.id)}
          onUnfulfillAndRescue={(shiftId) => markUnfulfilledAndRescue(shiftId)}
          onEdit={() => {
            requestAnimationFrame(() =>
              document.querySelector(".shift-form-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" }),
            );
            setEditorFor({
              id: selected.id,
              role: selected.role,
              startsAt: selected.startsAt,
              endsAt: selected.endsAt,
              pay: selected.pay,
              assignedEmployeeId: selected.assignedEmployeeId,
            });
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

const DOCK_STEPS = ["Request", "Calling", "Accepted", "Updating", "Confirmed"] as const;

/** Where the run has reached, mapped onto the five things an operator cares about. */
function dockStage(status: string): number {
  switch (status) {
    case "SHIFT_CREATED":
      return 0;
    case "CALLING_WORKER":
    case "WORKER_DECLINED":
      return 1;
    case "WORKER_ACCEPTED":
      return 2;
    case "TRIGGERING_VOICEOS":
    case "VOICEOS_COMPLETE":
      return 3;
    case "SENDING_SMS":
      return 4;
    case "COMPLETE":
      return 5;
    default:
      return 0;
  }
}

/** A persistent bar so the state of the call is readable from across a room. */
function ProgressDock({ rescue }: { rescue: Rescue }) {
  const stage = dockStage(rescue.status);
  const headline = rescue.callingName
    ? `Calling ${rescue.callingName}${rescue.callingLanguage ? ` · ${rescue.callingLanguage}` : ""}`
    : stage >= 5
      ? "Cover confirmed"
      : "Working through the team";

  return (
    <aside className="dock" aria-label="Coverage progress">
      <div className="dock-inner">
        <span className="dock-headline">
          <span className="live-dot" />
          {headline}
        </span>
        <ol className="dock-steps">
          {DOCK_STEPS.map((label, index) => (
            <li
              key={label}
              className={`dock-step${index < stage ? " dock-step-done" : index === stage ? " dock-step-active" : ""}`}
            >
              <span className="dock-step-dot" />
              <span className="dock-step-label">{label}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
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
  people,
  rescue,
  timeZone,
  canManage,
  busy,
  onAssign,
  onFindCoverage,
  onUnfulfillAndRescue,
  onEdit,
  onClose,
}: {
  shift: Shift;
  person: Person | null;
  people: Person[];
  rescue: Rescue;
  timeZone: string;
  canManage: boolean;
  busy: boolean;
  onAssign: (employeeId: string | null) => void;
  onFindCoverage: () => void;
  onUnfulfillAndRescue: (shiftId: string) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const isFilling = rescue.active && rescue.shiftId === shift.id;

  return (
    <section className="detail-panel" aria-label={`${shift.role} shift detail`}>
      <div className="card-head">
        <h2 className="card-title">{shift.role}</h2>
        <div className="form-actions">
          {canManage && (
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>
              Edit
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
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
          <span className="detail-label">
            {new Date(shift.endsAt) < new Date()
              ? "Finished"
              : new Date(shift.startsAt) < new Date()
                ? "Running"
                : "Starts"}
          </span>
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
          <span className="detail-label">Assigned to</span>
          <span className="detail-value">
            {canManage ? (
              <select
                className="select-inline"
                value={shift.assignedEmployeeId ?? ""}
                onChange={(e) => onAssign(e.target.value || null)}
                disabled={busy}
              >
                <option value="">Nobody assigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            ) : person ? (
              person.name
            ) : isFilling ? (
              rescueLabel(rescue)
            ) : (
              "Nobody yet"
            )}
          </span>
        </div>
        {person && rescue.shiftId === shift.id && rescue.confirmedBySms && (
          <div className="detail-row">
            <span className="detail-label">Confirmation</span>
            <span className="detail-value">Text message sent</span>
          </div>
        )}
      </div>

      {canManage && (
        <div className="detail-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {!person ? (
            <button className="btn btn-primary" onClick={onFindCoverage} disabled={busy || (rescue.active && rescue.shiftId !== shift.id)}>
              {busy ? "Starting…" : rescue.active && rescue.shiftId !== shift.id ? "Another shift is being covered" : "Find coverage"}
            </button>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => onAssign(null)}
                disabled={busy}
              >
                Unassign shift
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onUnfulfillAndRescue(shift.id)}
                disabled={busy || rescue.active}
              >
                {busy
                  ? "Starting…"
                  : rescue.active
                    ? "Busy with another shift"
                    : "Replace this person"}
              </button>
            </>
          )}
        </div>
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

function getRoleClass(role: string): string {
  const normalized = role.toLowerCase();
  if (normalized.includes("kitchen") || normalized.includes("cook") || normalized.includes("chef")) return "kitchen";
  if (normalized.includes("server") || normalized.includes("wait")) return "server";
  if (normalized.includes("bar") || normalized.includes("mixologist")) return "bartender";
  if (normalized.includes("manager") || normalized.includes("lead")) return "manager";
  return "default";
}
