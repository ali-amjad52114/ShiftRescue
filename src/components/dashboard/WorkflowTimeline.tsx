interface TimelineEvent {
  id: string;
  message: string;
  timestamp: string;
}

interface WorkflowTimelineProps {
  timeline: TimelineEvent[];
}

export function WorkflowTimeline({ timeline }: WorkflowTimelineProps) {
  return (
    <div className="glass-card">
      <h2 className="card-title">📜 Workflow Timeline</h2>
      {timeline.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "0.5rem 0" }}>
          No workflow events recorded yet.
        </div>
      ) : (
        <ul className="timeline-list">
          {timeline.map((item) => {
            const timeStr = new Date(item.timestamp).toLocaleTimeString();
            return (
              <li key={item.id} className="timeline-item">
                <div className="timeline-time">{timeStr}</div>
                <div className="timeline-msg">{item.message}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
