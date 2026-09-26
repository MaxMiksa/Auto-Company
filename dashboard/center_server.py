#!/usr/bin/env python3
"""Local multi-product center: explicit source scopes and owned execution."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
import sys
import threading
from urllib.parse import parse_qs, urlsplit


DASHBOARD_DIR = Path(__file__).resolve().parent
FRAMEWORK_ROOT = DASHBOARD_DIR.parent
if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))

from center_store import CenterError, CenterStore  # noqa: E402
from center_catalog import CenterCatalog  # noqa: E402
from center_runtime import CenterRuntime  # noqa: E402
from journal_data import JournalSource  # noqa: E402


API = "/api/center/v1"
IDENTIFIER = r"[A-Za-z0-9_-]{1,128}"
RESOURCE_IDENTIFIER = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,255}"
MAX_BODY = 64 * 1024
STATIC = {
    "/": ("center.html", "text/html; charset=utf-8"),
    "/center": ("center.html", "text/html; charset=utf-8"),
    "/center/": ("center.html", "text/html; charset=utf-8"),
    "/center.js": ("center.js", "application/javascript; charset=utf-8"),
    "/center.css": ("center.css", "text/css; charset=utf-8"),
    "/center-i18n.js": ("center-i18n.js", "application/javascript; charset=utf-8"),
    "/journal": ("index.html", "text/html; charset=utf-8"),
    "/journal/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/i18n.js": ("i18n.js", "application/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "AutoCompany" / "center"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "AutoCompany" / "center"
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "auto-company" / "center"


class CenterServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, address, store, catalog, runtime, framework_root=FRAMEWORK_ROOT):
        if address[0] not in {"127.0.0.1", "localhost"}:
            raise ValueError("The product center only accepts IPv4 loopback bindings")
        self.store = store
        self.catalog = catalog
        self.runtime = runtime
        self.framework_root = Path(framework_root)
        self.legacy = JournalSource(self.framework_root)
        super().__init__(address, CenterHandler)
        self._refresh_stop = threading.Event()
        self._refresh_thread = threading.Thread(target=self._refresh_sources, daemon=True)
        self._refresh_thread.start()

    def _refresh_sources(self):
        while not self._refresh_stop.wait(5):
            try:
                self.catalog.refresh_changed_sources(batch_size=8)
            except Exception as error:
                logging.error("Catalog refresh failed: %s", type(error).__name__)

    def server_close(self):
        self._refresh_stop.set()
        self._refresh_thread.join()
        super().server_close()


class CenterHandler(BaseHTTPRequestHandler):
    server: CenterServer

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def respond(self, body, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json(self, data, status=200):
        self.respond(json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                     "application/json; charset=utf-8", status)

    def result(self, data, status=200):
        self.json({"schemaVersion": 1, "centerId": self.server.store.center_id,
                   "revision": self.server.store.revision,
                   "observedAt": datetime.now(timezone.utc).isoformat(), "data": data, "warnings": []}, status)

    def error(self, code, message, status=400, details=None):
        self.json({"code": code, "messageKey": code, "message": message,
                   "params": details or {}, "retryable": status == 503,
                   "currentRevision": self.server.store.revision}, status)

    def allowed(self):
        port = self.server.server_address[1]
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if (len(self.headers.get_all("Host", [])) != 1 or host not in hosts
                or len(self.headers.get_all("Origin", [])) > 1
                or origin not in {None, f"http://{host}"}
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.error("LOCAL_ORIGIN_REQUIRED", "Only same-origin local requests are allowed.", 403)
            return False
        return True

    def parsed(self):
        if len(self.path) > 8192:
            raise CenterError("INVALID_REQUEST", "Request URL is too long.", status=400)
        request = urlsplit(self.path)
        if request.scheme or request.netloc or request.fragment:
            raise CenterError("INVALID_REQUEST", "An origin-relative URL is required.", status=400)
        values = parse_qs(request.query, keep_blank_values=True, max_num_fields=16)
        if any(len(value) != 1 for value in values.values()):
            raise CenterError("INVALID_REQUEST", "Duplicate query parameters are not allowed.", status=400)
        return request.path, {key: value[0] for key, value in values.items()}

    def read_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise CenterError("INVALID_REQUEST", "Transfer encoding is not supported.", status=400)
        if self.headers.get_content_type() != "application/json":
            raise CenterError("JSON_REQUIRED", "A JSON object is required.", status=415)
        if len(self.headers.get_all("Content-Length", [])) != 1:
            raise CenterError("INVALID_REQUEST", "One content length is required.", status=411)
        try:
            length = int(self.headers["Content-Length"])
        except (TypeError, ValueError):
            raise CenterError("INVALID_REQUEST", "Invalid content length.", status=400) from None
        if not 0 <= length <= MAX_BODY:
            raise CenterError("REQUEST_TOO_LARGE", "Request body exceeds the size limit.", status=413)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise CenterError("INVALID_REQUEST", "Incomplete request body.", status=400)
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError("Duplicate JSON key")
                result[key] = value
            return result
        body = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite number")))
        if not isinstance(body, dict):
            raise CenterError("INVALID_REQUEST", "A JSON object is required.", status=400)
        # A local HTTP request does not authenticate a person or a runner.
        body["_provenance"] = {"channel": "local_api"}
        return body

    def do_GET(self):  # noqa: N802
        if not self.allowed():
            return
        try:
            path, query = self.parsed()
            asset = STATIC.get(path)
            if re.fullmatch(rf"/products/{IDENTIFIER}/?", path):
                asset = ("index.html", "text/html; charset=utf-8")
            if asset:
                self.respond((DASHBOARD_DIR / asset[0]).read_bytes(), asset[1])
            elif path.startswith(API + "/"):
                self.get_api(path[len(API):], query)
            elif path == "/api/journal":
                self.json(self.server.legacy.snapshot())
            elif path == "/api/status":
                self.json(self.server.legacy.legacy_status())
            elif path == "/api/usage":
                self.json(self.server.legacy.legacy_usage(query.get("period", "day"), query.get("date")))
            elif path == "/api/language":
                self.json(self.server.legacy.language())
            elif not query and (media := re.fullmatch(r"/api/product-media/([0-9a-f]{32})/([A-Za-z0-9_.-]+\.(?:png|svg))", path)):
                content, mime = self.server.legacy.media_resource(*media.groups())
                self.respond(content, mime)
            elif path == "/api/journal/log" and set(query) == {"id"}:
                self.json(self.server.legacy.log(query["id"]))
            elif path == "/api/journal/document" and set(query) == {"path"}:
                content, _ = self.server.legacy.document(query["path"])
                self.respond(content.encode("utf-8"), "text/plain; charset=utf-8")
            elif path == "/api/log-tail":
                lines = max(1, min(int(query.get("lines", "180")), 1000))
                self.json({"ok": True, "readOnly": True, "lines": lines, "logTail": self.server.legacy.log_tail(lines)})
            else:
                self.error("NOT_FOUND", "Resource not found.", 404)
        except Exception as error:
            self.handle_error(error)

    def get_api(self, route, query):
        catalog, runtime = self.server.catalog, self.server.runtime
        if route == "/summary":
            self.result(runtime.summary())
        elif route == "/entries":
            result = catalog.list_entries(query)
            result["items"] = [runtime.decorate_entry(entry) for entry in result["items"]]
            self.result(result)
        elif route == "/requests":
            self.result(runtime.list_requests(query))
        elif route == "/preferences":
            self.result(runtime.preferences())
        elif match := re.fullmatch(rf"/requests/({IDENTIFIER})", route):
            self.result(runtime.get_request(match[1]))
        elif match := re.fullmatch(rf"/operations/({IDENTIFIER})", route):
            self.result(runtime.operation(match[1]))
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})", route):
            self.result(runtime.decorate_entry(catalog.get_entry(match[1], query.get("sourceId"))))
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})/(journal|exploration|usage)", route):
            if match[2] == "usage":
                self.result(catalog.usage(match[1], query))
            else:
                params = dict(query)
                if match[2] == "exploration":
                    params["section"] = "exploration"
                result = catalog.journal(match[1], params)
                if isinstance(result.get("entry"), dict):
                    result["entry"] = runtime.decorate_entry(result["entry"])
                self.result(result)
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})/records/({IDENTIFIER})", route):
            self.result(catalog.record(match[1], match[2], query.get("sourceId")))
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})/resources/({RESOURCE_IDENTIFIER})", route):
            content, mime = catalog.resource(match[1], match[2], query.get("sourceId"))
            # Business HTML must never execute under the control application's origin.
            if mime.split(";", 1)[0].lower() not in {"text/plain", "application/json", "image/png", "image/svg+xml"}:
                mime = "text/plain; charset=utf-8"
            self.respond(content, mime)
        else:
            self.error("NOT_FOUND", "Resource not found.", 404)

    def do_POST(self):  # noqa: N802
        if not self.allowed():
            return
        try:
            path, query = self.parsed()
            if query or not path.startswith(API + "/"):
                raise CenterError("NOT_FOUND", "Write endpoint not found.", status=404)
            body = self.read_body()
            self.post_api(path[len(API):], body)
        except Exception as error:
            self.handle_error(error)

    def post_api(self, route, body):
        catalog, runtime = self.server.catalog, self.server.runtime
        if route == "/imports/probe":
            self.result(catalog.probe(body))
        elif route == "/imports/commit":
            self.result(catalog.commit(body))
        elif route == "/explorations":
            self.result(runtime.create_exploration(body), 202)
        elif route == "/requests":
            self.result(runtime.create_request(body), 202)
        elif route == "/preferences":
            self.result(runtime.preferences(body))
        elif match := re.fullmatch(rf"/requests/({IDENTIFIER})/(cancel|stop|reconcile)", route):
            self.result(runtime.request_action(match[1], match[2], body), 202)
        elif match := re.fullmatch(r"/queue/(order|pause|resume|stop-all)", route):
            self.result(runtime.queue_action(match[1], body))
        elif match := re.fullmatch(rf"/sources/({IDENTIFIER})/(takeover|release|reconnect)", route):
            if match[2] == "reconnect":
                self.result(catalog.reconnect(match[1], body))
            else:
                self.result(runtime.source_action(match[1], match[2], body), 202)
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})/(archive|restore|detach|source-selection)", route):
            self.result(catalog.entry_action(match[1], match[2], body))
        elif match := re.fullmatch(rf"/entries/({IDENTIFIER})/(media/capture|preview/start|preview/stop)", route):
            self.result(runtime.media_action(match[1], match[2], body), 202)
        else:
            self.error("NOT_FOUND", "Write endpoint not found.", 404)

    def handle_error(self, error):
        if isinstance(error, CenterError):
            self.error(error.code, error.message, error.status, error.details)
        elif isinstance(error, (ValueError, UnicodeError, json.JSONDecodeError)):
            self.error("INVALID_REQUEST", "Invalid request or source data.", 400)
        elif isinstance(error, FileNotFoundError):
            self.error("SOURCE_MISSING", "The requested source is no longer available.", 404)
        else:
            # Do not leak local paths, command lines or credential-bearing exceptions.
            logging.error("Center operation failed: %s", type(error).__name__)
            self.error("CENTER_UNAVAILABLE", "The operation could not be completed. Check local diagnostics.", 503)

    def log_message(self, format, *args):
        # Access logs deliberately exclude URLs/bodies; sources can contain private names.
        logging.info("Center HTTP request completed")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=("127.0.0.1", "localhost"), default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8810)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--source", action="append", type=Path, default=[], help="Explicit read-only source to register")
    parser.add_argument("--framework-root", type=Path, default=FRAMEWORK_ROOT)
    parser.add_argument("--wsl-distro")
    parser.add_argument("--wsl-user")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    if bool(args.wsl_distro) != bool(args.wsl_user):
        parser.error("--wsl-distro and --wsl-user must be supplied together")
    domain = ({"platform": "wsl", "distribution": args.wsl_distro, "user": args.wsl_user}
              if args.wsl_distro else None)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    store = CenterStore(args.data_dir)
    runtime = None
    server = None
    try:
        catalog = CenterCatalog(store)
        for source in args.source:
            candidate = catalog.probe({"root": str(source.resolve())})
            catalog.commit({"candidateId": candidate["candidateId"], "candidateHash": candidate["candidateHash"],
                            "mode": "readonly", "idempotencyKey": "source-" + candidate["candidateId"]})
        runtime = CenterRuntime(store, catalog, args.framework_root, execution_domain=domain)
        server = CenterServer((args.host, args.port), store, catalog, runtime, args.framework_root)
        runtime.start()
        print(f"Product center: http://{args.host}:{server.server_address[1]}/center", flush=True)
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None:
            server.server_close()
        if runtime is not None:
            runtime.close()
        store.close()


if __name__ == "__main__":
    main()
