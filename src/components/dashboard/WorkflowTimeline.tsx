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
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <svg className="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          Workflow timeline
        </h2>
      </div>

      {timeline.length === 0 ? (
        <p className="empty">No events yet. Every step of the rescue is logged here as it happens.</p>
      ) : (
        <ul className="timeline">
          {timeline.map((item, index) => (
            <li
              key={item.id}
              className={`timeline-item${index === timeline.length - 1 ? " timeline-item-latest" : ""}`}
            >
              <div className="timeline-time">
                <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString()}</time>
              </div>
              <div className="timeline-msg">{item.message}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
