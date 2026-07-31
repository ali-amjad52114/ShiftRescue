"use client";

import { useEffect, useRef } from "react";

interface TimelineEvent {
  id: string;
  message: string;
  timestamp: string;
}

interface WorkflowTimelineProps {
  timeline: TimelineEvent[];
}

export function WorkflowTimeline({ timeline }: WorkflowTimelineProps) {
  const listRef = useRef<HTMLOListElement>(null);
  // Track whether the viewer is parked at the newest event. If they scrolled up
  // to read an earlier step, new events must not yank the view away from them.
  const stickToNewest = useRef(true);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToNewest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToNewest.current) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <svg className="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          Workflow timeline
        </h2>
        {timeline.length > 0 && (
          <span className="card-count">
            {timeline.length} {timeline.length === 1 ? "event" : "events"}
          </span>
        )}
      </div>

      {timeline.length === 0 ? (
        <p className="empty">No events yet. Every step of the rescue is logged here as it happens.</p>
      ) : (
        <ol className="timeline" ref={listRef} onScroll={handleScroll}>
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
        </ol>
      )}
    </section>
  );
}
