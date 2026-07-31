"use client";

import { useState } from "react";
import { zonedTimeToInstant } from "@/lib/time/schedule";

interface Person {
  id: string;
  name: string;
  active: boolean;
}

export interface ShiftDraft {
  id?: string;
  role: string;
  startsAt: string;
  endsAt: string;
  pay: string;
  assignedEmployeeId: string | null;
}

/** Split an instant into the date and time fields the form edits, in venue time. */
function toFields(iso: string, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return { date, time };
}

function toInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return zonedTimeToInstant(year, month, day, hour, minute, timeZone).toISOString();
}

export function ShiftForm({
  shift,
  people,
  timeZone,
  onSaved,
  onCancel,
}: {
  shift: ShiftDraft | null;
  people: Person[];
  timeZone: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const now = new Date();
  const initialStart = shift ? toFields(shift.startsAt, timeZone) : { date: toFields(now.toISOString(), timeZone).date, time: "18:00" };
  const initialEnd = shift ? toFields(shift.endsAt, timeZone) : { date: initialStart.date, time: "22:00" };

  const [role, setRole] = useState(shift?.role ?? "");
  const [date, setDate] = useState(initialStart.date);
  const [start, setStart] = useState(initialStart.time);
  const [end, setEnd] = useState(initialEnd.time);
  const [pay, setPay] = useState(shift?.pay ?? "");
  const [assignee, setAssignee] = useState(shift?.assignedEmployeeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(shift?.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const startsAt = toInstant(date, start, timeZone);
      // An end earlier than the start means the shift runs past midnight.
      let endsAt = toInstant(date, end, timeZone);
      if (new Date(endsAt) <= new Date(startsAt)) {
        const [y, m, d] = date.split("-").map(Number);
        const [h, min] = end.split(":").map(Number);
        endsAt = zonedTimeToInstant(y, m, d + 1, h, min, timeZone).toISOString();
      }

      const body = { role, startsAt, endsAt, pay, assignedEmployeeId: assignee || null };
      const res = await fetch(editing ? `/api/shifts/${shift!.id}` : "/api/shifts", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Could not save the shift");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!shift?.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/${shift.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Could not remove the shift");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{editing ? "Edit shift" : "Add a shift"}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>

      <form className="form form-grid" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Role</span>
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Kitchen Assistant" required />
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Starts</span>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Ends</span>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Pay</span>
          <input className="input" value={pay} onChange={(e) => setPay(e.target.value)} placeholder="$24 per hour" />
        </label>
        <label className="field">
          <span className="field-label">Assigned to</span>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Leave unfilled</option>
            {people
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || role.trim() === ""}>
            {busy ? "Saving…" : editing ? "Save shift" : "Add shift"}
          </button>
          {editing && (
            <button className="btn btn-ghost" type="button" onClick={remove} disabled={busy}>
              Delete shift
            </button>
          )}
        </div>
      </form>

      {error && <p className="notice">{error}</p>}
    </section>
  );
}
