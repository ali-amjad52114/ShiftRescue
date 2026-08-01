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

interface Preflight {
  ready: boolean;
  failing: string[];
  checks: Record<string, boolean>;
  context: {
    runtime: string;
    storage: string;
    timeZone: string;
    activeStaff: number;
    callableStaff: number;
    openUpcomingShifts: number;
    webhookUrl?: string;
  };
}

/** Plain-English consequence of each preflight check, so a red row is actionable. */
const CHECK_LABELS: Record<string, string> = {
  sharedState: "Shared state (Redis) — without it the webhook and the browser see different runs",
  ownCredentials: "Own APP_PASSWORD + APP_SESSION_SECRET (not the built-in demo login)",
  webhookReachable: "Vapi can reach this deployment — set PUBLIC_BASE_URL",
  vapiCredentials: "Vapi API key, assistant and phone number",
  a1mobileCredentials: "a1mobile team key for sending the confirmation SMS",
  a1mobileNumber: "a1mobile number claimed",
  realCallsEnabled: "SIMULATE is off — sim- ids are not sponsor proof",
  outboundDialling: "ORIGINATION is outbound",
  rosterCallable: "Every active staff member has a phone number",
  haveShiftToRescue: "An uncovered upcoming shift exists to rescue",
};

/** The ids VoiceOS returns. All five are required — the backend rejects blanks. */
const VOICEOS_FIELDS = [
  { key: "calendarEventId", label: "Google Calendar event ID" },
  { key: "slackMessageId", label: "Slack message ID" },
  { key: "gmailMessageId", label: "Gmail message ID" },
  { key: "spreadsheetId", label: "Google Sheet ID" },
  { key: "spreadsheetUpdateRange", label: "Sheet update range" },
] as const;

type VoiceosDraft = Record<(typeof VOICEOS_FIELDS)[number]["key"], string>;

const EMPTY_DRAFT: VoiceosDraft = {
  calendarEventId: "",
  slackMessageId: "",
  gmailMessageId: "",
  spreadsheetId: "",
  spreadsheetUpdateRange: "",
};

/**
 * Operator console. Everything here is the machinery behind the schedule —
 * state machine, integration proof, manual advance and reset. It is deliberately
 * kept off the customer-facing product.
 */
export function AdminConsole() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<VoiceosDraft>(EMPTY_DRAFT);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.ok) setData(await res.json());
  }, []);

  const loadPreflight = useCallback(async () => {
    const res = await fetch("/api/preflight");
    if (res.ok) setPreflight(await res.json());
  }, []);

  useEffect(() => {
    load();
    loadPreflight();
    const poll = setInterval(load, 1500);
    return () => clearInterval(poll);
  }, [load, loadPreflight]);

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
  const steps = railStates(data.status, data.proof, Boolean(data.shift?.assignedWorkerId));
  const draftComplete = VOICEOS_FIELDS.every((field) => draft[field.key].trim() !== "");
  const callInProgress = data.status === "CALLING_WORKER";

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
      {notice && <p className="notice">{notice}</p>}

      {preflight && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Deployment readiness</h2>
            <span className={`status-tag status-tag-${preflight.ready ? "done" : "failed"}`}>
              {preflight.ready ? "Ready" : `${preflight.failing.length} to fix`}
            </span>
          </div>

          <div className="detail-list">
            {Object.entries(preflight.checks).map(([key, ok]) => (
              <div className="detail-row" key={key}>
                <span className="detail-label">{ok ? "OK" : "Fix"}</span>
                <span className={`detail-value${ok ? "" : " detail-value-alert"}`}>
                  {CHECK_LABELS[key] ?? key}
                </span>
              </div>
            ))}
            <div className="detail-row">
              <span className="detail-label">Runtime</span>
              <span className="detail-value">
                {preflight.context.runtime} · {preflight.context.storage} · {preflight.context.timeZone}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Callable staff</span>
              <span className="detail-value">
                {preflight.context.callableStaff} / {preflight.context.activeStaff}
              </span>
            </div>
            {preflight.context.webhookUrl && (
              <div className="detail-row">
                <span className="detail-label">Vapi webhook</span>
                <span className="detail-value proof-val">{preflight.context.webhookUrl}</span>
              </div>
            )}
          </div>

          <p className="empty">
            Registering the webhook is what lets Vapi report a call that nobody answered. Without it
            a no-answer leaves the rescue stuck on the worker who never picked up.
          </p>
          <div className="hero-actions">
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                setNotice(null);
                try {
                  const res = await fetch("/api/admin/vapi-sync", { method: "POST" });
                  const json = await res.json();
                  if (res.ok) setNotice(`Vapi assistant now points at ${json.target}`);
                  else setError(json.error ?? "Could not sync the assistant");
                } finally {
                  setBusy(false);
                  await loadPreflight();
                }
              }}
            >
              Register webhook with Vapi
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={loadPreflight}>
              Re-check
            </button>
          </div>
        </section>
      )}

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
          <h2 className="card-title">Record a decision by hand</h2>
        </div>
        <p className="empty">
          For when a call connected but the assistant&rsquo;s tool webhook never arrived. The call
          attempt is matched on the server, so these only work while a call is actually in progress.
        </p>
        <div className="hero-actions">
          <button
            className="btn btn-ghost"
            disabled={busy || !callInProgress}
            onClick={() => post("/api/admin/decision", { decision: "declined" })}
          >
            Worker declined
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !callInProgress}
            onClick={() => post("/api/admin/decision", { decision: "accepted" })}
          >
            Worker accepted
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !callInProgress}
            onClick={() => post("/api/admin/decision", { decision: "needs_clarification" })}
          >
            No clear answer
          </button>
          {!callInProgress && (
            <span className="hero-actions-note">No call is in progress.</span>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Enter VoiceOS proof</h2>
        </div>
        <p className="empty">
          Paste the ids VoiceOS actually returned. All five are required and the backend rejects
          blanks &mdash; there is no way to mark this step done without real values.
        </p>
        <div className="form-grid">
          {VOICEOS_FIELDS.map((field) => (
            <label className="field" key={field.key}>
              <span className="field-label">{field.label}</span>
              <input
                className="input"
                value={draft[field.key]}
                onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !draftComplete}
            onClick={async () => {
              await post("/api/voiceos-result", {
                success: true,
                scheduleUpdated: true,
                ...Object.fromEntries(
                  VOICEOS_FIELDS.map((f) => [f.key, draft[f.key].trim()]),
                ),
              });
              setDraft(EMPTY_DRAFT);
            }}
          >
            Submit VoiceOS proof
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => post("/api/voiceos-result", { success: false })}
          >
            VoiceOS failed
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
        <p className="empty">
          Clears the current rescue: timeline, proof IDs and the shift in progress. The rescued
          shift goes back to uncovered, so the demo can be run again.
        </p>
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
