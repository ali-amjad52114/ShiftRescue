"use client";

import { useCallback, useEffect, useState } from "react";
import { ShiftCard } from "./ShiftCard";
import { WorkerStatus } from "./WorkerStatus";
import { WorkflowTimeline } from "./WorkflowTimeline";
import { ProofPanel } from "./ProofPanel";
import { WORKFLOW_STEPS, statusMeta } from "./status";

interface StatusResponse {
  status: string;
  shift: {
    role: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    pay: string;
  } | null;
  currentWorker: string | null;
  language: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  proof: {
    callId?: string;
    scheduleUpdated?: boolean;
    calendarEventId?: string;
    slackMessageId?: string;
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

const SIDE_EFFECTS = ["scheduleUpdated", "calendarEventId", "slackMessageId", "smsMessageId"] as const;

export function DashboardView() {
  const [data, setData] = useState<StatusResponse>(INITIAL);
  const [connected, setConnected] = useState(false);
  const [resetting, setResetting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData(await res.json());
      setConnected(true);
    } catch (e) {
      setConnected(false);
      console.error("Error fetching status:", e);
    }
  }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) await fetchStatus();
    } catch (e) {
      console.error("Error resetting state:", e);
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const meta = statusMeta(data.status);
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
            updates the schedule, calendar and Slack — and shows the receipts.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={handleReset} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset demo"}
            </button>
            <a className="btn btn-ghost" href="/api/status">
              Raw status JSON
            </a>
          </div>
        </div>

        <aside className="stat-card">
          <div className="card-head">
            <p className="eyebrow eyebrow-inverse">Current status</p>
            <span className="live-pill">
              <span className={`live-dot${connected ? "" : " live-dot-idle"}`} />
              {connected ? "Live" : "Offline"}
            </span>
          </div>
          <p className="stat-value">{meta.label}</p>
          <dl className="mini-list">
            <div className="mini-row">
              <dt className="mini-label">Workers called</dt>
              <dd className="mini-value">
                {called} / {workerCount}
              </dd>
            </div>
            <div className="mini-row">
              <dt className="mini-label">Language on the call</dt>
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
          {WORKFLOW_STEPS.map((label, index) => {
            const stepState =
              index < meta.step ? "done" : index === meta.step ? "active" : "pending";
            return (
              <li key={label} className={`rail-step rail-step-${stepState}`}>
                <span className="rail-step-index">
                  {String(index + 1).padStart(2, "0")} · {stepState}
                </span>
                <span className="rail-step-label">{label}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="card-grid">
        <ShiftCard shift={data.shift} status={data.status} />
        <WorkerStatus
          currentWorker={data.currentWorker}
          language={data.language}
          status={data.status}
        />
        <WorkflowTimeline timeline={data.timeline} />
        <ProofPanel proof={data.proof ?? {}} />
      </div>
    </main>
  );
}
