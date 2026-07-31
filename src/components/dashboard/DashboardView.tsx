"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShiftCard } from "./ShiftCard";
import { WorkerStatus } from "./WorkerStatus";
import { WorkflowTimeline } from "./WorkflowTimeline";
import { ProofPanel } from "./ProofPanel";
import { WORKFLOW_STEPS, railStates, statusMeta } from "./status";

interface StatusResponse {
  status: string;
  shift: {
    role: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    pay: string;
    assignedWorkerId: string | null;
  } | null;
  currentWorker: string | null;
  language: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  proof: {
    callId?: string;
    scheduleUpdated?: boolean;
    calendarEventId?: string;
    slackMessageId?: string;
    gmailMessageId?: string;
    spreadsheetId?: string;
    spreadsheetUpdateRange?: string;
    smsMessageId?: string;
  };
  state?: {
    workers?: Array<{ id: string }>;
    currentWorkerIndex?: number;
  };
}

const INITIAL: StatusResponse = {
  status: "WAITING_FOR_MANAGER_COMMAND",
  shift: null,
  currentWorker: null,
  language: null,
  timeline: [],
  proof: {},
};

const SIDE_EFFECTS = [
  "scheduleUpdated",
  "calendarEventId",
  "slackMessageId",
  "gmailMessageId",
  "spreadsheetId",
  "spreadsheetUpdateRange",
  "smsMessageId",
] as const;

export function DashboardView() {
  const [data, setData] = useState<StatusResponse>(INITIAL);
  const [connected, setConnected] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /**
   * Workflow state lives in memory, and Vercel serves requests from several
   * function instances — so a poll can land on an instance that never saw the
   * run and answers with an empty workflow. Keep the furthest-along state the
   * backend has actually reported instead of flickering back to "waiting".
   *
   * This never invents progress: it only holds on to events the backend really
   * sent. A reset clears the mark so a genuinely empty run displays.
   */
  const seenEvents = useRef(-1);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json: StatusResponse = await res.json();
      setConnected(true);
      if (json.timeline.length >= seenEvents.current) {
        seenEvents.current = json.timeline.length;
        setData(json);
      }
    } catch (e) {
      setConnected(false);
      console.error("Error fetching status:", e);
    }
  }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      // An intentional reset is the one case where going backwards is correct.
      if (res.ok) {
        seenEvents.current = -1;
        await fetchStatus();
      }
    } catch (e) {
      console.error("Error resetting state:", e);
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/voiceos-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "Kitchen Assistant",
          date: "July 31",
          startTime: "6:00 PM",
          endTime: "10:00 PM",
          location: "Downtown San Francisco",
          pay: "$24 per hour",
        }),
      });
      const result = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !result.success) {
        throw new Error(result.error || `Start failed (${res.status})`);
      }
      seenEvents.current = -1;
      await fetchStatus();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the rescue");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Escape backs out of the reset confirmation, as any confirm prompt should.
  useEffect(() => {
    if (!confirmingReset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmingReset(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingReset]);

  const meta = statusMeta(data.status);
  const failed = meta.tone === "failed";
  const hasAcceptance = Boolean(data.shift?.assignedWorkerId);
  const steps = railStates(data.status, hasAcceptance);

  const workerCount = data.state?.workers?.length ?? 3;
  const workerIndex = data.state?.currentWorkerIndex ?? -1;
  const called = workerIndex >= 0 ? workerIndex + 1 : 0;
  const verified = SIDE_EFFECTS.filter((key) => Boolean(data.proof?.[key])).length;

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Live voice workflow</p>
          <h1 className="display">Coverage, closed on a call.</h1>
          <p className="lede">
            A manager speaks once. ShiftRescue calls workers in their own language, gets a real answer, then
            updates the schedule, Calendar, Slack, Gmail and Sheets — and shows the receipts.
          </p>
          {/* Reset wipes a live demo run, so it is a two-step, non-primary action.
              The accent only appears on the confirm, where it is the intended action. */}
          <div className="hero-actions">
            {confirmingReset ? (
              <>
                <button className="btn btn-primary" onClick={handleReset} disabled={resetting} autoFocus>
                  {resetting ? "Resetting…" : "Yes, wipe this run"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmingReset(false)}
                  disabled={resetting}
                >
                  Cancel
                </button>
                <span className="hero-actions-note">This clears the timeline and every proof ID.</span>
              </>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  onClick={handleStart}
                  disabled={starting || data.status !== "WAITING_FOR_MANAGER_COMMAND"}
                >
                  {starting ? "Starting…" : "Start rescue"}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmingReset(true)}>
                  Reset demo
                </button>
                <a className="btn btn-ghost" href="/api/status">
                  Raw status JSON
                </a>
                {startError && <span className="hero-actions-note">{startError}</span>}
              </>
            )}
          </div>
        </div>

        <aside
          className={`stat-card${failed ? " stat-card-failed" : ""}`}
          aria-label="Current workflow status"
        >
          <div className="card-head">
            <p className="eyebrow eyebrow-inverse">Current status</p>
            <span className={`live-pill${connected ? "" : " live-pill-offline"}`}>
              <span className={`live-dot${connected ? "" : " live-dot-idle"}`} />
              {connected ? "Live" : "Reconnecting"}
            </span>
          </div>
          {/* Polled every 1.5s — announce changes rather than silently swapping text. */}
          <p className="stat-value" aria-live="polite">
            {meta.label}
          </p>
          {failed && (
            <p className="stat-alert">
              {hasAcceptance
                ? "A worker accepted, but the follow-up actions did not complete. The shift is not confirmed."
                : "No worker accepted. The shift is still uncovered and nothing was scheduled."}
            </p>
          )}
          <dl className="mini-list">
            <div className="mini-row">
              <dt className="mini-label">Workers called</dt>
              <dd className="mini-value">
                {called} / {workerCount}
              </dd>
            </div>
            <div className="mini-row">
              <dt className="mini-label">Call language</dt>
              <dd className="mini-value">{data.language ?? "—"}</dd>
            </div>
            <div className="mini-row">
              <dt className="mini-label">Verified side effects</dt>
              <dd className="mini-value">
                {verified} / {SIDE_EFFECTS.length}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="rail">
        <p className="eyebrow">Rescue sequence</p>
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
      </section>

      <div className="card-grid">
        <ShiftCard shift={data.shift} status={data.status} />
        <WorkerStatus
          currentWorker={data.currentWorker}
          language={data.language}
          status={data.status}
          hasAcceptance={hasAcceptance}
        />
        <WorkflowTimeline timeline={data.timeline} />
        <ProofPanel proof={data.proof ?? {}} />
      </div>
    </main>
  );
}
