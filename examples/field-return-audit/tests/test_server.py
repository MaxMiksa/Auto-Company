import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import server
from fixtures import INTEGER_BOUNDARIES, integer_mismatch_payload, integer_parent_payload, integer_payload, payload


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.create_server(host="127.0.0.1", port=0)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def json_request(self, body):
        return self.request("POST", "/api/audit", json.dumps(body).encode(), {"Content-Type": "application/json"})

    def test_health_is_reachable_only_on_loopback(self):
        self.assertEqual(self.httpd.server_address[0], "127.0.0.1")
        status, headers, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertTrue(json.loads(body))

    def test_non_loopback_binding_rejected(self):
        for host in ("0.0.0.0", "192.0.2.1", "::"):
            with self.subTest(host=host):
                with self.assertRaises(ValueError):
                    server.create_server(host=host, port=0)

    def test_real_http_file_upload_and_hash_evidence(self):
        status, headers, body = self.json_request(payload())
        self.assertEqual(status, 200, body)
        result = json.loads(body)
        self.assertEqual(result["status"], "passed", result)
        self.assertEqual(len(result["evidence"]["databases"]), 3)
        self.assertIn("sha256", json.dumps(result["evidence"]))

    def test_http_integer_boundary_protocol_and_failure_values_are_lossless(self):
        for request, expected_status in ((integer_payload(), "passed"), (integer_mismatch_payload(), "review")):
            with self.subTest(status=expected_status):
                status, headers, body = self.json_request(request)
                self.assertEqual(status, 200, body)
                result = json.loads(body)
                self.assertEqual(result["status"], expected_status)
                records = [change for change in result["changes"] if change["table"] == "records"]
                indexed = {change["key"]["uid"]["value"]: change for change in records}
                self.assertEqual(set(indexed), {str(value) for value in INTEGER_BOUNDARIES})
                for value in INTEGER_BOUNDARIES:
                    self.assertEqual(indexed[str(value)]["expected"]["metric"], {"type": "integer", "value": str(value)})
                if expected_status == "review":
                    orphan = next(issue for issue in result["issues"] if issue["kind"] == "relation_orphan")
                    self.assertEqual(orphan["actual"], {"type": "integer", "value": str(-(2 ** 63))})

    def test_parent_described_single_record_keeps_exact_key_and_three_values(self):
        status, headers, body = self.json_request(integer_parent_payload())
        self.assertEqual(status, 200, body)
        result = json.loads(body)
        self.assertEqual(result["status"], "review")
        self.assertEqual(len(result["changes"]), 1)
        change = result["changes"][0]
        self.assertEqual(change["key"], {"uid": {"type": "integer", "value": "9007199254740993"}})
        self.assertEqual([change[source]["note"] for source in ("before", "expected", "actual")], ["old", "new", "wrong"])
        self.assertEqual(result["issues"][0]["key"], change["key"])

    def test_demo_api_returns_auditable_upload_request(self):
        status, headers, body = self.request("GET", "/api/demo")
        self.assertEqual(status, 200, body)
        demo = json.loads(body)
        self.assertIn("field", demo)
        status, headers, body = self.json_request(demo)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["status"], "passed")

    def test_bad_request_then_valid_retry(self):
        for body in (b"{bad json", b"[]", b"null"):
            with self.subTest(body=body):
                status, headers, response = self.request("POST", "/api/audit", body, {"Content-Type": "application/json"})
                self.assertEqual(status, 400, response)
                self.assertIn("error", json.loads(response))
                self.assertNotIn(b"Traceback", response)
        status, headers, body = self.json_request(payload())
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["status"], "passed")

    def test_invalid_sqlite_does_not_leak_stack_and_service_recovers(self):
        request = payload()
        request["field"]["data"] = "bm90IHNxbGl0ZQ=="
        status, headers, body = self.json_request(request)
        self.assertEqual(status, 400, body)
        self.assertIn("error", json.loads(body))
        self.assertNotIn(b"Traceback", body)
        self.assertEqual(self.request("GET", "/api/health")[0], 200)

    def test_oversized_http_body_rejected_before_read(self):
        with patch.object(server, "MAX_REQUEST_BYTES", 1024):
            status, headers, body = self.request("POST", "/api/audit", b"{}", {
                "Content-Type": "application/json", "Content-Length": "2048",
            })
        self.assertIn(status, (400, 413), body)
        self.assertIn("error", json.loads(body))
        self.assertEqual(self.request("GET", "/api/health")[0], 200)

    def test_static_app_has_security_headers(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200, body)
        self.assertIn("text/html", headers.get("Content-Type", ""))
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertTrue(headers.get("Content-Security-Policy"))

    def test_unknown_and_traversal_paths_do_not_expose_source(self):
        for path in ("/api/missing", "/../audit.py", "/%2e%2e/audit.py", "/server.py"):
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                self.assertIn(status, (400, 404))
                self.assertNotIn(b"def audit(", body)
                self.assertNotIn(b"import sqlite3", body)

    def test_cross_origin_audit_rejected(self):
        status, headers, body = self.request("POST", "/api/audit", json.dumps(payload()).encode(), {
            "Content-Type": "application/json", "Origin": "https://untrusted.example.invalid",
        })
        self.assertIn(status, (400, 403), body)

    def test_xss_payload_remains_data_in_json_response(self):
        request = payload()
        request["config"]["job_name"] = "<img src=x onerror=alert('xss')>"
        status, headers, body = self.json_request(request)
        self.assertEqual(status, 200, body)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertEqual(json.loads(body)["job_name"], request["config"]["job_name"])


if __name__ == "__main__":
    unittest.main()
