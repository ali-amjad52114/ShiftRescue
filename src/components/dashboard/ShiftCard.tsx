import { statusMeta, statusTagClass } from "./status";

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
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <svg className="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 10h18" />
          </svg>
          Uncovered shift
        </h2>
        <span className={statusTagClass(status)}>{statusMeta(status).label}</span>
      </div>

      {!shift ? (
        <p className="empty">Waiting for the manager&rsquo;s VoiceOS command to create the shift.</p>
      ) : (
        <div className="detail-list">
          <div className="detail-row">
            <span className="detail-label">Role</span>
            <span className="detail-value">{shift.role}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Date &amp; time</span>
            <span className="detail-value">
              {shift.date} · {shift.startTime}&ndash;{shift.endTime}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Location</span>
            <span className="detail-value">{shift.location}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Offered pay</span>
            <span className="detail-value">{shift.pay}</span>
          </div>
        </div>
      )}
    </section>
  );
}
