interface WorkflowProof {
  callId?: string;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  gmailMessageId?: string;
  spreadsheetId?: string;
  spreadsheetUpdateRange?: string;
  smsMessageId?: string;
}

interface ProofPanelProps {
  proof: WorkflowProof;
}

export function ProofPanel({ proof }: ProofPanelProps) {
  const rows: Array<{ key: string; value: string }> = [];

  if (proof.callId) rows.push({ key: "Vapi call ID", value: proof.callId });
  if (proof.scheduleUpdated) rows.push({ key: "Schedule app", value: "shift marked FILLED" });
  if (proof.calendarEventId) rows.push({ key: "Google Calendar event", value: proof.calendarEventId });
  if (proof.slackMessageId) rows.push({ key: "Slack message", value: proof.slackMessageId });
  if (proof.gmailMessageId) rows.push({ key: "Gmail message", value: proof.gmailMessageId });
  if (proof.spreadsheetId) rows.push({ key: "Google Sheet", value: proof.spreadsheetId });
  if (proof.spreadsheetUpdateRange) rows.push({ key: "Sheet update", value: proof.spreadsheetUpdateRange });
  if (proof.smsMessageId) rows.push({ key: "a1mobile SMS", value: proof.smsMessageId });

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <svg className="card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          Verified side effects
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="empty">
          Nothing verified yet. IDs appear only when VoiceOS and a1mobile report a real side effect back to
          the backend.
        </p>
      ) : (
        <>
          <div className="proof-list">
            {rows.map((row) => (
              <div className="proof-row" key={row.key}>
                <span className="proof-key">{row.key}</span>
                <span className="proof-val">{row.value}</span>
              </div>
            ))}
          </div>
          <p className="proof-note">Every ID is returned by the integration that performed the action.</p>
        </>
      )}
    </section>
  );
}
