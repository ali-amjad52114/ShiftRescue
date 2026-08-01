interface WorkflowProof {
  callId?: string;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  gmailMessageId?: string;
  spreadsheetId?: string;
  spreadsheetUpdateRange?: string;
  smsMessageId?: string;
  voiceosFailed?: boolean;
}

interface ProofPanelProps {
  proof: WorkflowProof;
}

/**
 * A development placeholder, not evidence. The API contract states that any id
 * containing `sim-` or `mock-` is not sponsor proof, and this is where that
 * rule has to be visible — an id rendered in the same type as a real one reads
 * as a real side effect to anyone looking at the screen.
 */
function isPlaceholder(value: string): boolean {
  return /(^|[-_])(sim|mock)-/i.test(value);
}

export function ProofPanel({ proof }: ProofPanelProps) {
  const rows: Array<{ key: string; value: string; placeholder: boolean }> = [];

  const add = (key: string, value: string | undefined) => {
    if (!value) return;
    rows.push({ key, value, placeholder: isPlaceholder(value) });
  };

  add("Vapi call ID", proof.callId);
  if (proof.scheduleUpdated) {
    rows.push({ key: "Schedule app", value: "shift marked FILLED", placeholder: false });
  }
  add("Google Calendar event", proof.calendarEventId);
  add("Slack message", proof.slackMessageId);
  add("Gmail message", proof.gmailMessageId);
  add("Google Sheet", proof.spreadsheetId);
  add("Sheet update", proof.spreadsheetUpdateRange);
  add("a1mobile SMS", proof.smsMessageId);

  const placeholders = rows.filter((row) => row.placeholder).length;

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

      {proof.voiceosFailed && (
        <p className="stat-alert">
          VoiceOS reported that it could not complete its updates. Anything it would have created
          does not exist.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty">
          Nothing verified yet. IDs appear only when VoiceOS and a1mobile report a real side effect
          back to the backend.
        </p>
      ) : (
        <>
          <div className="proof-list">
            {rows.map((row) => (
              <div className="proof-row" key={row.key}>
                <span className="proof-key">{row.key}</span>
                <span className={`proof-val${row.placeholder ? " proof-val-placeholder" : ""}`}>
                  {row.value}
                  {row.placeholder && <span className="proof-flag">simulated · not proof</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="proof-note">
            {placeholders > 0
              ? `${placeholders} of these ${placeholders === 1 ? "is a" : "are"} simulated placeholder${placeholders === 1 ? "" : "s"}. Turn SIMULATE off for a real run — these must not be presented as sponsor proof.`
              : "Every ID is returned by the integration that performed the action."}
          </p>
        </>
      )}
    </section>
  );
}
