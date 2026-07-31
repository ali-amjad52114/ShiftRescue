interface WorkflowProof {
  callId?: string;
  scheduleUpdated?: boolean;
  calendarEventId?: string;
  slackMessageId?: string;
  smsMessageId?: string;
}

interface ProofPanelProps {
  proof: WorkflowProof;
}

export function ProofPanel({ proof }: ProofPanelProps) {
  const hasProof = Object.keys(proof).length > 0;

  return (
    <div className="glass-card">
      <h2 className="card-title">🔐 Verification & Side Effect Proof</h2>
      {!hasProof ? (
        <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "0.5rem 0" }}>
          Proof IDs will appear here once VoiceOS & a1mobile complete side effects.
        </div>
      ) : (
        <div>
          {proof.calendarEventId && (
            <div className="proof-badge">
              <span className="proof-key">Google Calendar Event ID</span>
              <span className="proof-val">{proof.calendarEventId}</span>
            </div>
          )}
          {proof.slackMessageId && (
            <div className="proof-badge">
              <span className="proof-key">Slack Message ID</span>
              <span className="proof-val">{proof.slackMessageId}</span>
            </div>
          )}
          {proof.smsMessageId && (
            <div className="proof-badge">
              <span className="proof-key">a1mobile SMS ID</span>
              <span className="proof-val">{proof.smsMessageId}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
