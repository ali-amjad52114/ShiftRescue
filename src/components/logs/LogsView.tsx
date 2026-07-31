"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTime } from "@/lib/time/schedule";

interface Status {
  status: string;
  shift: { id: string; role: string; location: string; pay: string; assignedWorkerId: string | null } | null;
  currentWorker: string | null;
  language: string | null;
  timeline: Array<{ id: string; message: string; timestamp: string }>;
  proof: Record<string, unknown>;
}

export function LogsView() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load live logs");
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 1500);
    return () => clearInterval(interval);
  }, [fetchLogs, autoRefresh]);

  return (
    <main className="page">
      <header className="schedule-head">
        <div>
          <p className="eyebrow">Public Live Telemetry</p>
          <h1 className="page-title">Operational Rescue Logs</h1>
        </div>
        <div className="week-nav">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (1.5s)
          </label>
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs}>
            Refresh
          </button>
          <a className="btn btn-ghost btn-sm" href="/api/status" target="_blank" rel="noreferrer">
            Raw JSON API
          </a>
        </div>
      </header>

      {error && <p className="notice">{error}</p>}

      {!data ? (
        <section className="card">
          <p className="empty">Loading system logs…</p>
        </section>
      ) : (
        <>
          <section className="coverage-strip">
            <div className="coverage-stat">
              <span className="coverage-label">Engine Status:</span>
              <span className="coverage-value" style={{ textTransform: "uppercase", fontSize: "16px" }}>
                {data.status.replace(/_/g, " ")}
              </span>
            </div>
            {data.shift && (
              <div className="coverage-stat">
                <span className="coverage-label">Shift:</span>
                <span className="coverage-value" style={{ fontSize: "16px" }}>
                  {data.shift.role}
                </span>
              </div>
            )}
            {data.currentWorker && (
              <div className="coverage-stat">
                <span className="coverage-label">Active Worker:</span>
                <span className="coverage-value" style={{ fontSize: "16px" }}>
                  {data.currentWorker} ({data.language})
                </span>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Live Event Timeline ({data.timeline.length} events)</h2>
            </div>
            {data.timeline.length === 0 ? (
              <p className="empty">No active rescue logs recorded yet. Initiate a shift rescue on the schedule to see live call logs.</p>
            ) : (
              <ul className="timeline">
                {data.timeline.map((entry, index) => (
                  <li key={entry.id || index} className={`timeline-item ${index === data.timeline.length - 1 ? "timeline-item-latest" : ""}`}>
                    <div className="timeline-time">
                      {new Date(entry.timestamp).toLocaleString()} ({formatTime(entry.timestamp, "UTC")})
                    </div>
                    <div className="timeline-msg">{entry.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Integration Verification & Proof Receipts</h2>
            </div>
            {Object.keys(data.proof).length === 0 ? (
              <p className="empty">No integration receipts recorded for current rescue yet.</p>
            ) : (
              <div className="proof-list">
                {Object.entries(data.proof).map(([key, value]) => (
                  <div key={key} className="proof-row">
                    <span className="proof-key">{key}</span>
                    <span className="proof-val">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
