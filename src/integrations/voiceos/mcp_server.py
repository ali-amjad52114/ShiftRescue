"""VoiceOS MCP bridge for the ShiftRescue demo workflow.

The server uses MCP's stdio transport.  Never print diagnostic output to stdout:
stdout is reserved for protocol messages.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
LOGGER = logging.getLogger("shiftrescue.voiceos")

DEFAULT_BASE_URL = "http://localhost:3000"
HTTP_TIMEOUT_SECONDS = 10
MAX_POLL_TIMEOUT_SECONDS = 120
MIN_POLL_INTERVAL_SECONDS = 0.25

mcp = FastMCP("ShiftRescue VoiceOS")


class BackendRequestError(RuntimeError):
    """A normalized failure returned by the ShiftRescue backend client."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        response: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.response = response


def _base_url() -> str:
    return os.environ.get("SHIFTRESCUE_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _spreadsheet_id() -> str:
    return os.environ.get("SHIFTRESCUE_SPREADSHEET_ID", "").strip()


def _request_json(
    method: str, path: str, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Send one JSON request. Kept separate so local tests can patch it."""
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{_base_url()}/{path.lstrip('/')}",
        data=body,
        method=method.upper(),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )

    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            raw_body = response.read().decode("utf-8")
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed_body: Any = json.loads(raw_body) if raw_body else None
        except json.JSONDecodeError:
            parsed_body = raw_body
        raise BackendRequestError(
            "backend_http_error",
            f"ShiftRescue returned HTTP {exc.code}.",
            status_code=exc.code,
            response=parsed_body,
        ) from exc
    except (URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise BackendRequestError(
            "backend_unavailable", f"Could not reach ShiftRescue: {reason}"
        ) from exc

    try:
        result = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise BackendRequestError(
            "invalid_backend_response", "ShiftRescue returned invalid JSON."
        ) from exc

    if not isinstance(result, dict):
        raise BackendRequestError(
            "invalid_backend_response", "ShiftRescue returned a non-object JSON value."
        )

    return result


def _error_result(error: BackendRequestError) -> dict[str, Any]:
    details: dict[str, Any] = {}
    if error.status_code is not None:
        details["statusCode"] = error.status_code
    if error.response is not None:
        details["response"] = error.response
    return _result(
        ok=False,
        retryable=error.code in {"backend_unavailable", "backend_http_error"}
        and (error.status_code is None or error.status_code >= 500),
        code=error.code.upper(),
        message=str(error),
        data=details or None,
    )


def _result(
    *,
    ok: bool,
    retryable: bool,
    code: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": ok,
        "retryable": retryable,
        "code": code,
        "message": message,
    }
    if data is not None:
        result["data"] = data
    return result


def _validation_error(message: str) -> dict[str, Any]:
    return _result(
        ok=False,
        retryable=False,
        code="VALIDATION_ERROR",
        message=message,
    )


def _backend_success(
    response: dict[str, Any], *, code: str, message: str
) -> dict[str, Any]:
    if response.get("success") is False:
        return _result(
            ok=False,
            retryable=False,
            code="BACKEND_REJECTED",
            message=str(response.get("message") or "ShiftRescue rejected the request."),
            data={"backend": response},
        )
    return _result(
        ok=True,
        retryable=False,
        code=code,
        message=message,
        data={"backend": response},
    )


@mcp.tool()
def start_shift_rescue(
    role: str,
    date: str,
    start_time: str,
    end_time: str,
    location: str,
    pay: str = "",
) -> dict[str, Any]:
    """Start ShiftRescue from a manager's spoken shift-coverage request.

    Supply the role, date, start/end times, and location extracted from speech.
    Pay is optional. Returns the ShiftRescue backend response.
    """
    required = {
        "role": role,
        "date": date,
        "start_time": start_time,
        "end_time": end_time,
        "location": location,
    }
    missing = [name for name, value in required.items() if not value.strip()]
    if missing:
        return _validation_error(
            "Required fields cannot be blank: " + ", ".join(missing) + "."
        )

    payload = {
        "role": role.strip(),
        "date": date.strip(),
        "startTime": start_time.strip(),
        "endTime": end_time.strip(),
        "location": location.strip(),
        "pay": pay.strip(),
    }
    LOGGER.info("Starting ShiftRescue for role %s", payload["role"])
    try:
        response = _request_json("POST", "/api/voiceos-command", payload)
    except BackendRequestError as error:
        LOGGER.warning("Could not start ShiftRescue: %s", error)
        return _error_result(error)
    result = _backend_success(
        response,
        code="SHIFT_STARTED",
        message="ShiftRescue started the shift-coverage workflow.",
    )
    result.setdefault("data", {})["integration"] = {
        "spreadsheetId": _spreadsheet_id(),
        "sheetName": "Shift Events",
        "beforeStage": "BEFORE_CALL",
        "afterStage": "AFTER_CALL",
    }
    return result


@mcp.tool()
def wait_for_shift_acceptance(
    timeout_seconds: float = 30, poll_interval_seconds: float = 2
) -> dict[str, Any]:
    """Wait briefly for a worker to accept the active shift.

    Polling is bounded to 120 seconds. If it times out, call this tool again to
    continue waiting rather than holding one VoiceOS tool call indefinitely.
    """
    if timeout_seconds < 0 or timeout_seconds > MAX_POLL_TIMEOUT_SECONDS:
        return _validation_error(
            f"timeout_seconds must be between 0 and {MAX_POLL_TIMEOUT_SECONDS}."
        )
    if poll_interval_seconds < MIN_POLL_INTERVAL_SECONDS:
        return _validation_error(
            f"poll_interval_seconds must be at least {MIN_POLL_INTERVAL_SECONDS}."
        )

    deadline = time.monotonic() + timeout_seconds
    accepted_statuses = {"WORKER_ACCEPTED", "TRIGGERING_VOICEOS"}
    completed_statuses = {"VOICEOS_COMPLETE", "SENDING_SMS", "COMPLETE"}
    last_state: dict[str, Any] | None = None

    while True:
        try:
            last_state = _request_json("GET", "/api/status")
        except BackendRequestError as error:
            LOGGER.warning("Could not read ShiftRescue status: %s", error)
            return _error_result(error)

        nested_state = last_state.get("state")
        workflow_state = nested_state if isinstance(nested_state, dict) else last_state
        status = last_state.get("status") or workflow_state.get("status")
        if status in completed_statuses:
            return _result(
                ok=True,
                retryable=False,
                code="ALREADY_COMPLETED",
                message="VoiceOS actions were already recorded. Do not repeat external actions.",
                data={
                    "status": status,
                    "shift": last_state.get("shift") or workflow_state.get("shift"),
                    "proof": last_state.get("proof") or workflow_state.get("proof") or {},
                    "nextAction": "Report the existing completion to the manager without changing the schedule, Calendar, or Slack again.",
                },
            )

        if status in accepted_statuses:
            shift = last_state.get("shift") or workflow_state.get("shift")
            workers = last_state.get("workers") or workflow_state.get("workers") or []
            assigned_worker_id = (
                shift.get("assignedWorkerId") if isinstance(shift, dict) else None
            ) or last_state.get("workerId") or workflow_state.get("currentWorkerId")
            worker = next(
                (
                    candidate
                    for candidate in workers
                    if isinstance(candidate, dict)
                    and candidate.get("id") == assigned_worker_id
                ),
                None,
            )
            if not isinstance(shift, dict) or worker is None:
                return _result(
                    ok=False,
                    retryable=False,
                    code="INVALID_BACKEND_STATE",
                    message="The backend reported an acceptance without a resolvable shift and worker.",
                    data={"status": status},
                )
            return _result(
                ok=True,
                retryable=False,
                code="WORKER_ACCEPTED",
                message="A worker accepted the shift. VoiceOS can complete the external updates.",
                data={
                    "status": status,
                    "worker": worker,
                    "shift": shift,
                    "nextAction": "Update the schedule, create the Calendar event, post the Slack confirmation, send the Gmail confirmation, append the AFTER_CALL Google Sheets row, then call report_shift_completion.",
                },
            )

        if status in {"INCOMPLETE", "WAITING_FOR_MANAGER_COMMAND"}:
            return _result(
                ok=False,
                retryable=False,
                code=(
                    "WORKFLOW_INCOMPLETE"
                    if status == "INCOMPLETE"
                    else "NO_ACTIVE_SHIFT"
                ),
                message=(
                    "The workflow ended without an accepted worker."
                    if status == "INCOMPLETE"
                    else "No shift-coverage workflow is active."
                ),
                data={"lastStatus": status},
            )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return _result(
                ok=False,
                retryable=True,
                code="WAIT_TIMEOUT",
                message="No worker accepted before this polling window ended. Call this tool again to continue waiting.",
                data={"lastStatus": status},
            )
        time.sleep(min(poll_interval_seconds, remaining))


@mcp.tool()
def report_shift_completion(
    schedule_updated: bool,
    calendar_event_id: str,
    slack_message_id: str,
    gmail_message_id: str,
    spreadsheet_id: str,
    spreadsheet_update_range: str,
    success: bool = True,
    error: str = "",
) -> dict[str, Any]:
    """Report proof after VoiceOS completes all connected-app updates.

    Pass the real Calendar, Slack, Gmail, and Google Sheets proof values. On a
    failed automation, set success to false and describe the failure in error.
    """
    if success and not schedule_updated:
        return _validation_error(
            "schedule_updated must be true when reporting successful completion."
        )
    proof_values = (
        calendar_event_id.strip(),
        slack_message_id.strip(),
        gmail_message_id.strip(),
        spreadsheet_id.strip(),
        spreadsheet_update_range.strip(),
    )
    if success and any(not value for value in proof_values):
        return _validation_error(
            "calendar_event_id, slack_message_id, gmail_message_id, spreadsheet_id, and spreadsheet_update_range are required on success."
        )
    if success and any(
        "mock" in proof_id.lower()
        for proof_id in proof_values
    ):
        return _validation_error(
            "Mock proof values are not accepted; provide proof returned by each real connected-app action."
        )
    configured_spreadsheet_id = _spreadsheet_id()
    if success and configured_spreadsheet_id and spreadsheet_id.strip() != configured_spreadsheet_id:
        return _validation_error(
            "spreadsheet_id does not match SHIFTRESCUE_SPREADSHEET_ID."
        )
    if not success and not error.strip():
        return _validation_error("error is required when success is false.")

    payload = {
        "success": success,
        "scheduleUpdated": schedule_updated,
        "calendarEventId": calendar_event_id.strip(),
        "slackMessageId": slack_message_id.strip(),
        "gmailMessageId": gmail_message_id.strip(),
        "spreadsheetId": spreadsheet_id.strip(),
        "spreadsheetUpdateRange": spreadsheet_update_range.strip(),
    }
    if error.strip():
        payload["error"] = error.strip()

    LOGGER.info("Reporting VoiceOS completion (success=%s)", success)
    try:
        response = _request_json("POST", "/api/voiceos-result", payload)
    except BackendRequestError as request_error:
        LOGGER.warning("Could not report VoiceOS completion: %s", request_error)
        return _error_result(request_error)
    return _backend_success(
        response,
        code="COMPLETION_REPORTED",
        message="ShiftRescue recorded the VoiceOS completion proof.",
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
