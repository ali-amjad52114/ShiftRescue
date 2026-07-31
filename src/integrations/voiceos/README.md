# VoiceOS MCP bridge

This local MCP server lets VoiceOS start a ShiftRescue workflow, wait for a worker to accept, and return proof after VoiceOS updates the schedule, Google Calendar, Slack, Gmail, and the staffing/payroll Google Sheet.

## Backend connection

The bridge connects directly to the real ShiftRescue API. The backend stores the manager's shift, advances the worker-calling workflow, exposes the accepted worker through `GET /api/status`, and records VoiceOS completion proof.

## Windows setup

Start the ShiftRescue web app first so `http://localhost:3000` is available. Then open PowerShell and run:

```powershell
cd C:\Users\aliam\Documents\ShiftRescue
py -m venv src\integrations\voiceos\.venv
.\src\integrations\voiceos\.venv\Scripts\python.exe -m pip install -r src\integrations\voiceos\requirements.txt
```

In VoiceOS, create an MCP integration named **ShiftRescue** and use this launch command:

```text
C:\Users\aliam\Documents\ShiftRescue\src\integrations\voiceos\.venv\Scripts\python.exe C:\Users\aliam\Documents\ShiftRescue\src\integrations\voiceos\mcp_server.py
```

Restart the integration after changing the server or its environment.

## Configuration

No environment variable is required for a local demo. The server defaults to `http://localhost:3000`.

Set `SHIFTRESCUE_BASE_URL` in the VoiceOS integration environment when the Next.js backend is at another origin, for example:

```text
SHIFTRESCUE_BASE_URL=https://shiftrescue.vercel.app
```

Do not add a trailing slash. This bridge does not use `VOICEOS_API_KEY`; VoiceOS launches it locally over stdio.

Set the seeded staffing/payroll spreadsheet ID in the same VoiceOS integration environment:

```text
SHIFTRESCUE_SPREADSHEET_ID=1F1n9DUsJrrfUfbmZTRc68L743mqTbuBrD_X7SyEI6LE
```

The workbook is a native Google Sheet: <https://docs.google.com/spreadsheets/d/1F1n9DUsJrrfUfbmZTRc68L743mqTbuBrD_X7SyEI6LE/edit>. The Sheet connector must have edit access. The Gmail connector must be able to send mail from the connected account.

## MCP tools

- `start_shift_rescue(role, date, start_time, end_time, location, pay="")` submits the manager's parsed command to `POST /api/voiceos-command`.
- `wait_for_shift_acceptance(timeout_seconds=30, poll_interval_seconds=2)` polls `GET /api/status` and returns when a worker accepts or the timeout expires.
- `report_shift_completion(schedule_updated, calendar_event_id, slack_message_id, gmail_message_id, spreadsheet_id, spreadsheet_update_range, success=True, error="")` sends the real completion proof to `POST /api/voiceos-result`.

Calendar, Slack, Gmail, and Sheet proof values must come from the actual actions VoiceOS completed. Do not submit placeholder IDs.

## VoiceOS instruction prompt

Paste this into the VoiceOS agent/integration instructions:

```text
You are the VoiceOS operator for ShiftRescue.

1. When a manager asks to fill a shift, extract role, date, start time, end time, location, and pay (pay may be empty). Confirm any missing required value, then call start_shift_rescue exactly once.
2. Read data.integration.spreadsheetId from the start_shift_rescue result. In its Shift Events tab, append one BEFORE_CALL row with the shift ID, scheduled worker, shift window, hourly rate, status Needs Coverage, and current timestamp. Copy the formulas in columns L, M, O, and P from the row above. Save the exact updated range.
3. Tell the manager outreach has started. Call wait_for_shift_acceptance with its default 30-second timeout. If it times out, call it again only when the manager asks you to continue checking.
4. When a worker is returned as accepted, use your existing app-control tools to change that shift from OPEN to FILLED and assign the accepted worker.
5. Create exactly one Google Calendar event for the accepted worker and shift.
6. Post exactly one Slack confirmation with the worker, role, date, time, and location.
7. Use Gmail to resolve the accepted worker's real email address from contacts or prior correspondence. If no unambiguous address exists, ask the manager; never guess. Send exactly one confirmation email containing the worker, role, date, start/end time, location, pay rate, and Calendar details. Capture the real Gmail message ID.
8. In the same Shift Events tab, append one AFTER_CALL row for the same shift ID. Preserve the scheduled worker, add the confirmed worker, actual start/end when known, hourly rate, status Confirmed, Gmail sent=true, Gmail message ID, Calendar event ID, Slack message ID, and current timestamp. Copy the formulas in columns L, M, O, and P. Capture the exact updated A1 range.
9. Read the new row back and verify the worker, calculated Actual Hours, and Estimated Pay. Then call report_shift_completion with schedule_updated=true and the real Calendar event ID, Slack message ID, Gmail message ID, spreadsheet ID, and spreadsheet update range.
10. Report completion to the manager. Never invent proof values, repeat an external action after it succeeds, or report success when an action failed.
```

## stdio caveats

- The MCP process is passive: the ShiftRescue backend cannot wake VoiceOS. VoiceOS must call the polling tool again after a timeout.
- The seeded rows are demo data, not evidence that Gmail was sent. Live runs must append new rows and use the connected Gmail and Google Drive apps; do not replace these actions with a mock backend.
- stdout is reserved for MCP protocol messages. Do not add `print()` debugging to the server; write diagnostics to stderr instead.
- VoiceOS launches the configured Python interpreter, so install dependencies into that same virtual environment.
- Keep the Next.js backend running and reachable from the computer where VoiceOS launches the server.
- Stop or restart the VoiceOS integration before manually launching another copy of the stdio server.
