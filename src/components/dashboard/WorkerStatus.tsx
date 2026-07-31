interface WorkerStatusProps {
  currentWorker: string | null;
  language: string | null;
  status: string;
}

function callState(status: string): string {
  switch (status) {
    case "CALLING_WORKER":
      return "In progress — Vapi call";
    case "WORKER_DECLINED":
      return "Declined";
    case "WORKER_ACCEPTED":
    case "TRIGGERING_VOICEOS":
    case "VOICEOS_COMPLETE":
    case "SENDING_SMS":
    case "COMPLETE":
      return "Accepted";
    default:
      return "Idle";
  }
}

export function WorkerStatus({ currentWorker, language, status }: WorkerStatusProps) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <svg className="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5c0-1 1-2 2-2h2l2 5-2 1a12 12 0 0 0 5 5l1-2 5 2v2c0 1-1 2-2 2A16 16 0 0 1 4 5Z" />
          </svg>
          Worker on the line
        </h2>
      </div>

      {currentWorker ? (
        <div className="detail-list">
          <div className="detail-row">
            <span className="detail-label">Worker</span>
            <span className="detail-value">{currentWorker}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Language spoken</span>
            <span className="detail-value">{language || "English"}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Call state</span>
            <span className="detail-value">{callState(status)}</span>
          </div>
        </div>
      ) : (
        <p className="empty">No call in progress. The first worker is dialled as soon as a shift arrives.</p>
      )}
    </section>
  );
}
