# VoiceOS MCP bridge

This local MCP server lets VoiceOS start a ShiftRescue workflow, wait for a worker to accept, and return proof after VoiceOS updates the schedule, Google Calendar, and Slack.

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

## MCP tools

- `start_shift_rescue(role, date, start_time, end_time, location, pay="")` submits the manager's parsed command to `POST /api/voiceos-command`.
- `wait_for_shift_acceptance(timeout_seconds=30, poll_interval_seconds=2)` polls `GET /api/status` and returns when a worker accepts or the timeout expires.
- `report_shift_completion(schedule_updated, calendar_event_id, slack_message_id, success=True, error="")` sends the real completion proof to `POST /api/voiceos-result`.

Calendar and Slack IDs must come from the actual actions VoiceOS completed. Do not submit placeholder IDs.

## VoiceOS instruction prompt

Paste this into the VoiceOS agent/integration instructions:

```text
You are the VoiceOS operator for ShiftRescue.

1. When a manager asks to fill a shift, extract role, date, start time, end time, location, and pay (pay may be empty). Confirm any missing required value, then call start_shift_rescue exactly once.
2. Tell the manager outreach has started. Call wait_for_shift_acceptance with its default 30-second timeout. If it times out, call it again only when the manager asks you to continue checking.
3. When a worker is returned as accepted, use your existing app-control tools to change that shift from OPEN to FILLED and assign the accepted worker.
4. Create exactly one Google Calendar event for the accepted worker and shift.
5. Post exactly one Slack confirmation with the worker, role, date, time, and location.
6. Capture the real Calendar event ID and Slack message ID, then call report_shift_completion. Set schedule_updated=true only after the scheduling app visibly confirms the change.
7. Report completion to the manager. Never invent proof IDs, repeat an external action after it succeeds, or report success when an action failed.
```

## stdio caveats

- The MCP process is passive: the ShiftRescue backend cannot wake VoiceOS. VoiceOS must call the polling tool again after a timeout.
- stdout is reserved for MCP protocol messages. Do not add `print()` debugging to the server; write diagnostics to stderr instead.
- VoiceOS launches the configured Python interpreter, so install dependencies into that same virtual environment.
- Keep the Next.js backend running and reachable from the computer where VoiceOS launches the server.
- Stop or restart the VoiceOS integration before manually launching another copy of the stdio server.
