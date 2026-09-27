"""HTTP boundary checks; fixture data here is never used for acceptance screenshots."""

import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import center_server


class CenterHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.catalog = mock.Mock()
        self.runtime = mock.Mock()
        self.runtime.create_request.return_value = {"requestId": "one", "state": "queued"}
        self.catalog.journal.return_value = {"project": {"stableId": "selected"}, "cycles": []}
        self.catalog.resource.return_value = (b"<script>alert(1)</script>", "text/html")
        self.server = center_server.CenterServer(
            ("127.0.0.1", 0), SimpleNamespace(center_id="test-center", revision=3),
            self.catalog, self.runtime, Path(self.directory.name))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        status, output, response_headers = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return status, output, response_headers

    def test_cross_site_and_false_host_cannot_start_work(self):
        for headers in ({"Host": f"evil.invalid:{self.port}"},
                        {"Origin": "https://evil.invalid"},
                        {"Sec-Fetch-Site": "cross-site"},
                        {"Origin": f"http://127.0.0.1:{self.port + 1}"}):
            with self.subTest(headers=headers):
                status, _, _ = self.request("POST", "/api/center/v1/requests", "{}", headers)
                self.assertEqual(status, 403)
        self.runtime.create_request.assert_not_called()

    def test_bad_bodies_do_not_create_requests(self):
        for body, headers, expected in (
            ("{}", {"Content-Type": "text/plain"}, 415),
            ('{"kind":"continue","kind":"explore"}', {}, 400),
            ('{"value":NaN}', {}, 400),
            ("[]", {}, 400),
            ("{invalid", {}, 400),
            # Reject the declared size before upload; unread large payloads can
            # turn the server's early close into a Windows TCP reset.
            ("", {"Content-Length": str(center_server.MAX_BODY + 1)}, 413),
            ("{}", {"Transfer-Encoding": "chunked"}, 400),
        ):
            with self.subTest(expected=expected, prefix=body[:40]):
                status, _, _ = self.request("POST", "/api/center/v1/requests", body, headers)
                self.assertEqual(status, expected)
        self.runtime.create_request.assert_not_called()

    def test_accepted_request_keeps_queued_state_and_envelope(self):
        body = {"entryId": "selected", "idempotencyKey": "stable", "executionMode": "enqueue"}
        status, raw, _ = self.request("POST", "/api/center/v1/requests", json.dumps(body))
        result = json.loads(raw)
        self.assertEqual(status, 202)
        self.assertEqual(result["data"]["state"], "queued")
        self.assertEqual(result["centerId"], "test-center")
        self.runtime.create_request.assert_called_once_with({**body, "_provenance": {"channel": "local_api"}})

    def test_client_cannot_claim_runner_or_authenticated_provenance(self):
        body = {"_provenance": {"channel": "runner", "authenticatedUserId": "pretend-user"}}
        status, _, _ = self.request("POST", "/api/center/v1/requests", json.dumps(body))
        self.assertEqual(status, 202)
        self.runtime.create_request.assert_called_once_with({"_provenance": {"channel": "local_api"}})

    def test_journal_uses_url_scope_not_global_selection(self):
        status, raw, _ = self.request("GET", "/api/center/v1/entries/product-b/journal?sourceId=source-b&limit=5")
        self.assertEqual(status, 200)
        self.catalog.journal.assert_called_once_with("product-b", {"sourceId": "source-b", "limit": "5"})
        self.assertEqual(json.loads(raw)["data"]["project"]["stableId"], "selected")
        self.runtime.create_request.assert_not_called()

    def test_duplicate_query_rejected_before_source_read(self):
        status, _, _ = self.request("GET", "/api/center/v1/entries/product-b/journal?sourceId=a&sourceId=b")
        self.assertEqual(status, 400)
        self.catalog.journal.assert_not_called()

    def test_preparation_operations_are_readable_without_starting_work(self):
        self.runtime.list_operations.return_value = {"items": [
            {"operationId": "operation-failed", "kind": "explore", "state": "failed", "reason": "FRAMEWORK_UNVERIFIED"}
        ]}
        status, raw, _ = self.request("GET", "/api/center/v1/operations")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["data"]["items"][0]["reason"], "FRAMEWORK_UNVERIFIED")
        self.runtime.list_operations.assert_called_once_with({})
        self.runtime.create_request.assert_not_called()
        self.runtime.create_exploration.assert_not_called()

    def test_preparation_operations_reject_cross_site_reads(self):
        status, _, _ = self.request("GET", "/api/center/v1/operations", headers={"Origin": "https://evil.invalid"})
        self.assertEqual(status, 403)
        self.runtime.list_operations.assert_not_called()

    def test_business_html_cannot_execute_under_center_origin(self):
        status, raw, headers = self.request("GET", "/api/center/v1/entries/product-b/resources/document-a")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn(b"<script>", raw)

    def test_scope_and_path_cannot_be_replaced_with_arbitrary_file(self):
        for path in ("/api/center/v1/entries/../resources/secret", "/api/center/v1/entries/a/resources/%2e%2e",
                     "/private.env", "/api/center/v1/entries/a/resources/C:/secret"):
            with self.subTest(path=path):
                status, _, _ = self.request("GET", path)
                self.assertEqual(status, 404)
        self.catalog.resource.assert_not_called()

    def test_unexpected_exception_does_not_leak_local_secrets(self):
        self.runtime.create_request.side_effect = RuntimeError("PRIVATE-SENTINEL token=/home/private/auth.json")
        status, raw, _ = self.request("POST", "/api/center/v1/requests", "{}")
        self.assertEqual(status, 503)
        self.assertNotIn(b"PRIVATE-SENTINEL", raw)
        self.assertNotIn(b"/home/private", raw)

    def test_legacy_write_endpoint_cannot_start_global_service(self):
        status, _, _ = self.request("POST", "/api/action/start", "{}")
        self.assertEqual(status, 404)
        self.runtime.create_request.assert_not_called()

    def test_non_loopback_rejected_before_state_creation(self):
        with self.assertRaises(ValueError):
            center_server.CenterServer(("0.0.0.0", 0), None, None, None)


if __name__ == "__main__":
    unittest.main()
