"use client";

import { useCallback, useEffect, useState } from "react";

interface Employee {
  id: string;
  name: string;
  phone: string;
  language: string;
  role: string;
  active: boolean;
}

const BLANK = { name: "", phone: "", language: "", role: "" };

export function TeamManager() {
  const [people, setPeople] = useState<Employee[]>([]);
  const [draft, setDraft] = useState(BLANK);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/employees");
    if (res.ok) setPeople((await res.json()).employees);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Something went wrong");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await send("/api/employees", "POST", draft)) setDraft(BLANK);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (await send(`/api/employees/${editing.id}`, "PATCH", editing)) setEditing(null);
  };

  return (
    <main className="page">
      <header className="schedule-head">
        <div>
          <p className="eyebrow">Staff</p>
          <h1 className="page-title">Your team</h1>
        </div>
      </header>

      {error && <p className="notice">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">People</h2>
          <span className="card-count">{people.length} on the roster</span>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Speaks</th>
                <th>Phone</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td className="table-strong">{person.name}</td>
                  <td>{person.role || "—"}</td>
                  <td>{person.language}</td>
                  <td className="table-mono">{person.phone || "No number on file"}</td>
                  <td>
                    <span className={`status-tag${person.active ? " status-tag-done" : ""}`}>
                      {person.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="table-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(person)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => send(`/api/employees/${person.id}`, "PATCH", { active: !person.active })}
                    >
                      {person.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">{editing ? `Edit ${editing.name}` : "Add someone"}</h2>
          {editing && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
          )}
        </div>

        <form className="form form-grid" onSubmit={editing ? saveEdit : add}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={editing ? editing.name : draft.name}
              onChange={(e) =>
                editing ? setEditing({ ...editing, name: e.target.value }) : setDraft({ ...draft, name: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">Role</span>
            <input
              className="input"
              value={editing ? editing.role : draft.role}
              onChange={(e) =>
                editing ? setEditing({ ...editing, role: e.target.value }) : setDraft({ ...draft, role: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">Speaks</span>
            <input
              className="input"
              placeholder="Spanish"
              value={editing ? editing.language : draft.language}
              onChange={(e) =>
                editing
                  ? setEditing({ ...editing, language: e.target.value })
                  : setDraft({ ...draft, language: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">Phone</span>
            <input
              className="input"
              placeholder="+14155550123"
              value={editing ? editing.phone : draft.phone}
              onChange={(e) =>
                editing ? setEditing({ ...editing, phone: e.target.value }) : setDraft({ ...draft, phone: e.target.value })
              }
            />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {editing ? "Save changes" : "Add to team"}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={async () => {
                  if (await send(`/api/employees/${editing.id}`, "DELETE")) setEditing(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
