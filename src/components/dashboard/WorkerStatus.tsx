interface WorkerStatusProps {
  currentWorker: string | null;
  language: string | null;
  status: string;
}

export function WorkerStatus({ currentWorker, language, status }: WorkerStatusProps) {
  return (
    <div className="glass-card">
      <h2 className="card-title">📞 Active Worker Call</h2>
      {currentWorker ? (
        <div style={{ marginTop: "0.5rem" }}>
          <div className="detail-row">
            <span className="detail-label">Current Worker</span>
            <span className="detail-value" style={{ fontSize: "1.05rem", color: "var(--accent-amber)" }}>
              {currentWorker}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Preferred Language</span>
            <span className="detail-value">{language || "English"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Call Status</span>
            <span className="detail-value" style={{ color: "var(--accent-cyan)" }}>
              {status === "CALLING_WORKER" ? "In-Progress (Vapi Call)" : status}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ padding: "1rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
          No active call right now.
        </div>
      )}
    </div>
  );
}
