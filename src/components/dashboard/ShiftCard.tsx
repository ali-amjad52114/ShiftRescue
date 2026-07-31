interface ShiftCardProps {
  shift: {
    role: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    pay: string;
  } | null;
  status: string;
}

export function ShiftCard({ shift, status }: ShiftCardProps) {
  if (!shift) {
    return (
      <div className="glass-card">
        <h2 className="card-title">📅 Uncovered Shift</h2>
        <div style={{ padding: "1rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Waiting for manager command via VoiceOS...
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="card-title" style={{ margin: 0 }}>📅 Uncovered Shift</h2>
        <span className={`status-tag status-${status}`}>{status.replace(/_/g, " ")}</span>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <div className="detail-row">
          <span className="detail-label">Role</span>
          <span className="detail-value" style={{ color: "var(--accent-cyan)" }}>{shift.role}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Date & Time</span>
          <span className="detail-value">{shift.date} • {shift.startTime} – {shift.endTime}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Location</span>
          <span className="detail-value">{shift.location}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Offered Pay</span>
          <span className="detail-value" style={{ color: "var(--accent-emerald)" }}>{shift.pay}</span>
        </div>
      </div>
    </div>
  );
}
