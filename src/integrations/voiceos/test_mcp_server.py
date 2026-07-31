"""Contract tests for the dependency-light VoiceOS MCP bridge.

These tests deliberately mock the bridge's HTTP boundary. They can therefore be
run without Next.js, VoiceOS, Calendar, or Slack being available.
"""

from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import patch


VOICEOS_DIR = pathlib.Path(__file__).resolve().parent
if str(VOICEOS_DIR) not in sys.path:
    sys.path.insert(0, str(VOICEOS_DIR))

import mcp_server  # noqa: E402  (path is intentionally prepared above)


class VoiceOSMCPServerTests(unittest.TestCase):
    def test_start_shift_rescue_posts_the_documented_command_shape(self) -> None:
        backend = {"status": "SHIFT_CREATED", "shiftId": "shift-demo"}

        with patch.object(mcp_server, "_request_json", return_value=backend) as request:
            result = mcp_server.start_shift_rescue(
                role="Kitchen Assistant",
                date="July 31",
                start_time="6:00 PM",
                end_time="10:00 PM",
                location="Downtown San Francisco",
                pay="$24 per hour",
            )

        request.assert_called_once_with(
            "POST",
            "/api/voiceos-command",
            {
                "role": "Kitchen Assistant",
                "date": "July 31",
                "startTime": "6:00 PM",
                "endTime": "10:00 PM",
                "location": "Downtown San Francisco",
                "pay": "$24 per hour",
            },
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["code"], "SHIFT_STARTED")
        self.assertEqual(result["data"]["backend"], backend)

    def test_start_shift_rescue_rejects_missing_required_fields(self) -> None:
        with patch.object(mcp_server, "_request_json") as request:
            result = mcp_server.start_shift_rescue(
                role=" ",
                date="July 31",
                start_time="6:00 PM",
                end_time="10:00 PM",
                location="Downtown San Francisco",
            )

        request.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["code"], "VALIDATION_ERROR")

    def test_wait_resolves_the_accepted_worker_from_the_shift_assignment(self) -> None:
        accepted_status = {
            "status": "TRIGGERING_VOICEOS",
            "workerId": "worker-2",
            "shift": {
                "id": "shift-demo",
                "role": "Kitchen Assistant",
                "assignedWorkerId": "worker-2",
            },
            "state": {
                "status": "TRIGGERING_VOICEOS",
                "currentWorkerId": "worker-2",
                "workers": [
                    {"id": "worker-1", "name": "Maria", "language": "Spanish"},
                    {"id": "worker-2", "name": "Ahmed", "language": "Urdu"},
                ],
            },
        }

        with patch.object(
            mcp_server, "_request_json", return_value=accepted_status
        ) as request:
            result = mcp_server.wait_for_shift_acceptance(
                timeout_seconds=5, poll_interval_seconds=0.25
            )

        self.assertEqual(request.call_args.args[:2], ("GET", "/api/status"))
        self.assertTrue(result["ok"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["code"], "WORKER_ACCEPTED")
        self.assertEqual(result["data"]["status"], "TRIGGERING_VOICEOS")
        self.assertEqual(result["data"]["worker"]["id"], "worker-2")
        self.assertEqual(result["data"]["worker"]["name"], "Ahmed")
        self.assertEqual(result["data"]["shift"], accepted_status["shift"])
        self.assertTrue(result["data"]["nextAction"])

    def test_wait_times_out_with_the_last_observed_status(self) -> None:
        waiting_status = {
            "status": "CALLING_WORKER",
            "currentWorkerId": "worker-1",
            "shift": {"id": "shift-demo", "assignedWorkerId": None},
            "workers": [{"id": "worker-1", "name": "Maria"}],
        }

        with (
            patch.object(mcp_server, "_request_json", return_value=waiting_status),
            patch.object(mcp_server.time, "sleep") as sleep,
            patch.object(
                mcp_server.time, "monotonic", side_effect=[100.0, 100.0, 101.0, 101.0]
            ),
        ):
            result = mcp_server.wait_for_shift_acceptance(
                timeout_seconds=1, poll_interval_seconds=1
            )

        sleep.assert_called_once_with(1)
        self.assertFalse(result["ok"])
        self.assertTrue(result["retryable"])
        self.assertEqual(result["code"], "WAIT_TIMEOUT")
        self.assertEqual(result["data"]["lastStatus"], "CALLING_WORKER")

    def test_wait_does_not_repeat_actions_after_completion(self) -> None:
        completed_status = {
            "status": "COMPLETE",
            "shift": {"id": "shift-demo", "assignedWorkerId": "worker-2"},
            "proof": {
                "calendarEventId": "calendar_123",
                "slackMessageId": "slack_123",
            },
        }

        with patch.object(
            mcp_server, "_request_json", return_value=completed_status
        ):
            result = mcp_server.wait_for_shift_acceptance()

        self.assertTrue(result["ok"])
        self.assertFalse(result["retryable"])
        self.assertEqual(result["code"], "ALREADY_COMPLETED")
        self.assertEqual(result["data"]["proof"], completed_status["proof"])
        self.assertIn("without changing", result["data"]["nextAction"])

    def test_report_shift_completion_posts_all_proof_fields(self) -> None:
        backend = {"status": "VOICEOS_COMPLETE"}

        with patch.object(mcp_server, "_request_json", return_value=backend) as request:
            result = mcp_server.report_shift_completion(
                schedule_updated=True,
                calendar_event_id="calendar_123",
                slack_message_id="slack_123",
            )

        request.assert_called_once_with(
            "POST",
            "/api/voiceos-result",
            {
                "success": True,
                "scheduleUpdated": True,
                "calendarEventId": "calendar_123",
                "slackMessageId": "slack_123",
            },
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["code"], "COMPLETION_REPORTED")
        self.assertEqual(result["data"]["backend"], backend)

    def test_report_shift_completion_requires_real_success_proof(self) -> None:
        invalid_cases = (
            {
                "schedule_updated": False,
                "calendar_event_id": "calendar_123",
                "slack_message_id": "slack_123",
            },
            {
                "schedule_updated": True,
                "calendar_event_id": "",
                "slack_message_id": "slack_123",
            },
            {
                "schedule_updated": True,
                "calendar_event_id": "calendar_123",
                "slack_message_id": " ",
            },
            {
                "schedule_updated": True,
                "calendar_event_id": "MOCK-calendar-event-id",
                "slack_message_id": "slack_123",
            },
            {
                "schedule_updated": True,
                "calendar_event_id": "calendar_123",
                "slack_message_id": "mock-slack-message-id",
            },
        )

        for inputs in invalid_cases:
            with self.subTest(inputs=inputs):
                with patch.object(mcp_server, "_request_json") as request:
                    result = mcp_server.report_shift_completion(**inputs)

                request.assert_not_called()
                self.assertFalse(result["ok"])
                self.assertFalse(result["retryable"])
                self.assertEqual(result["code"], "VALIDATION_ERROR")

    def test_backend_unavailable_is_reported_as_retryable(self) -> None:
        backend_error = mcp_server.BackendRequestError(
            "backend_unavailable", "Could not reach ShiftRescue."
        )

        with patch.object(
            mcp_server, "_request_json", side_effect=backend_error
        ) as request:
            result = mcp_server.start_shift_rescue(
                role="Kitchen Assistant",
                date="July 31",
                start_time="6:00 PM",
                end_time="10:00 PM",
                location="Downtown San Francisco",
            )

        request.assert_called_once()
        self.assertFalse(result["ok"])
        self.assertTrue(result["retryable"])
        self.assertEqual(result["code"], "BACKEND_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
