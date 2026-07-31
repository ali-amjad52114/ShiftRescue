"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkflowTimeline } from "@/components/dashboard/WorkflowTimeline";
import { ProofPanel } from "@/components/dashboard/ProofPanel";
import { WORKFLOW_STEPS, railStates, statusMeta, statusTagClass } from "@/components/dashboard/status";

interface Status {
  status: string;
  shift: { id: string; role: string; assignedWorkerId: string | null } | null;
  currentWorker: string | null;
  workerId: string | null;
  language: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  proof: Record<string, unknown>;
}

/**
 * Operator console. Everything here is the machinery behind the schedule —
 * state machine, integration proof, manual advance and reset. It is deliberately
 * kept off the customer-facing product.
 */
export function AdminConsole() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 1500);
    return () => clearInterval(poll);
  }, [load]);

  const post = async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `Request failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <main className="page">
        <p className="empty">Loading console…</p>
      </main>
    );
  }

  const meta = statusMeta(data.status);
  const steps = railStates(data.status, Boolean(data.shift?.assignedWorkerId));

  return (
    <main className="page">
      <header className="schedule-head">
        <div>
          <p className="eyebrow">Internal</p>
          <h1 className="page-title">Operator console</h1>
        </div>
        <div className="week-nav">
          <a className="btn btn-ghost btn-sm" href="/api/status">
            Raw status
          </a>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await fetch("/api/session", { method: "DELETE" });
              window.location.href = "/";
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <p className="notice">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Rescue state</h2>
          <span className={statusTagClass(data.status)}>{meta.label}</span>
        </div>
        <ol className="rail-steps">
          {WORKFLOW_STEPS.map((label, index) => (
            <li key={label} className={`rail-step rail-step-${steps[index]}`}>
              <span className="rail-step-index">
                {String(index + 1).padStart(2, "0")} · {steps[index] === "pending" ? "not run" : steps[index]}
              </span>
              <span className="rail-step-label">{label}</span>
            </li>
          ))}
        </ol>
        <div className="detail-list">
          <div className="detail-row">
            <span className="detail-label">Shift</span>
            <span className="detail-value">{data.shift ? data.shift.role : "None in progress"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Worker on call</span>
            <span className="detail-value">
              {data.currentWorker ? `${data.currentWorker} (${data.language})` : "—"}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Advance the rescue manually</h2>
        </div>
        <p className="empty">
          These post the same payloads Vapi and VoiceOS send. Use them when an integration is not
          wired up yet — the dashboard still only ever shows what the backend recorded.
        </p>
        <div className="hero-actions">
          <button
            className="btn btn-ghost"
            disabled={busy || !data.workerId}
            onClick={() => post("/api/vapi-result", { workerId: data.workerId, decision: "declined" })}
          >
            Worker declined
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !data.workerId}
            onClick={() => post("/api/vapi-result", { workerId: data.workerId, decision: "accepted" })}
          >
            Worker accepted
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              post("/api/voiceos-result", {
                success: true,
                scheduleUpdated: true,
                calendarEventId: "",
                slackMessageId: "",
              })
            }
          >
            Submit VoiceOS result
          </button>
        </div>
      </section>

      <div className="card-grid">
        <WorkflowTimeline timeline={data.timeline} />
        <ProofPanel proof={data.proof} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Danger zone</h2>
        </div>
        <p className="empty">Clears the current rescue: timeline, proof IDs and the shift in progress.</p>
        {/* Destructive and irreversible, so it asks first. */}
        {confirmingReset ? (
          <div className="hero-actions">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                await post("/api/reset");
                setConfirmingReset(false);
              }}
            >
              {busy ? "Resetting…" : "Yes, clear this rescue"}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmingReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmingReset(true)}>
            Reset the current rescue
          </button>
        )}
      </section>
    </main>
  );
}
