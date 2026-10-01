#!/usr/bin/env python3
"""Serve a journal preview and the unchanged legacy dashboard, without controls."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import parse_qs, urlparse


DASHBOARD_DIR = Path(__file__).resolve().parent
if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))
from journal_data import JournalSource  # noqa: E402


STATIC = {
    "/journal/icons.js": ("icons.js", "application/javascript; charset=utf-8"),
    "/journal/design-system.css": ("design-system.css", "text/css; charset=utf-8"),
    "/icons.js": ("icons.js", "application/javascript; charset=utf-8"),
    "/design-system.css": ("design-system.css", "text/css; charset=utf-8"),
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/journal": ("index.html", "text/html; charset=utf-8"),
    "/journal/": ("index.html", "text/html; charset=utf-8"),
    "/journal/index.html": ("index.html", "text/html; charset=utf-8"),
    "/journal/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/journal/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/journal/i18n.js": ("i18n.js", "application/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/i18n.js": ("i18n.js", "application/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
LEGACY_ASSETS = {name: STATIC["/" + name][1] for name in ("app.js", "i18n.js", "styles.css", "favicon.svg")}


class JournalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], source: JournalSource, legacy_dir: Path | None = None):
        self.source = source
        self.legacy = JournalSource(legacy_dir) if legacy_dir is not None else None
        super().__init__(address, JournalHandler)


class JournalHandler(BaseHTTPRequestHandler):
    server: JournalServer

    def respond(self, body: bytes, content_type: str, code: int = 200, *, truncated: bool = False) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if truncated:
            self.send_header("X-Content-Truncated", "true")
        self.end_headers()
        self.wfile.write(body)

    def json(self, body: dict[str, Any], code: int = 200) -> None:
        self.respond(json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                     "application/json; charset=utf-8", code)

    def allowed(self) -> bool:
        port = self.server.server_address[1]
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        if (host not in {f"127.0.0.1:{port}", f"localhost:{port}"}
                or origin not in {None, f"http://{host}"}
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.json({"ok": False, "error": "Only same-origin local requests are allowed."}, 403)
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802
        if not self.allowed():
            return
        source = self.server.source
        try:
            request = urlparse(self.path)
            query = parse_qs(request.query, keep_blank_values=True, max_num_fields=12)
            if request.path in STATIC:
                relative, content_type = STATIC[request.path]
                self.respond((DASHBOARD_DIR / relative).read_bytes(), content_type)
            elif self.server.legacy is not None and request.path in {"/legacy", "/legacy/", "/legacy/index.html"}:
                content, _ = self.server.legacy.read("index.html")
                # The backup may use either root URLs or relative asset URLs.
                # Rewrite only the four advertised assets; never route arbitrary files.
                content = re.sub(r'((?:src|href)\s*=\s*["\'])(?:/|\./)?(app\.js|i18n\.js|styles\.css|favicon\.svg)(["\'])',
                                 r'\1/legacy/assets/\2\3', content, flags=re.I)
                self.respond(content.encode("utf-8"), "text/html; charset=utf-8")
            elif self.server.legacy is not None and request.path.removeprefix("/legacy/assets/") in LEGACY_ASSETS and request.path.startswith("/legacy/assets/"):
                name = request.path.removeprefix("/legacy/assets/")
                content, _ = self.server.legacy.read(name)
                self.respond(content.encode("utf-8"), LEGACY_ASSETS[name])
            elif request.path == "/api/journal":
                self.json({**source.snapshot(), "legacyAvailable": self.server.legacy is not None})
            elif request.path.startswith("/api/product-media/"):
                match = re.fullmatch(r"/api/product-media/([0-9a-f]{32})/([A-Za-z0-9_.-]+\.(?:png|svg))", request.path)
                if not match or query:
                    raise ValueError("Invalid media identity")
                raw, mime = source.media_resource(*match.groups())
                self.respond(raw, mime)
            elif request.path == "/api/journal/log":
                if set(query) != {"id"} or len(query["id"]) != 1:
                    raise ValueError("One cycle identity is required")
                self.json(source.log(query["id"][0]))
            elif request.path == "/api/journal/document":
                if set(query) != {"path"} or len(query["path"]) != 1:
                    raise ValueError("One document path is required")
                text, truncated = source.document(query["path"][0])
                if truncated:
                    text += "\n\n[Preview truncated at the document size limit.]\n"
                self.respond(text.encode("utf-8"), "text/plain; charset=utf-8", truncated=truncated)
            elif request.path == "/api/status":
                self.json(source.legacy_status())
            elif request.path == "/api/usage":
                self.json(source.legacy_usage(query.get("period", ["day"])[0], query.get("date", [None])[0]))
            elif request.path == "/api/language":
                self.json(source.language())
            elif request.path == "/api/log-tail":
                lines = max(1, min(int(query.get("lines", ["180"])[0]), 1000))
                self.json({"ok": True, "readOnly": True, "lines": lines, "logTail": source.log_tail(lines)})
            else:
                self.json({"ok": False, "error": "Not found"}, 404)
        except (ValueError, KeyError):
            self.json({"ok": False, "error": "Invalid or unavailable preview resource"}, 400)
        except OSError:
            self.json({"ok": False, "error": "Preview resource unavailable"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        self.json({"ok": False, "readOnly": True, "error": "This preview is read-only."}, 403)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--repo", type=Path, default=DASHBOARD_DIR.parent)
    parser.add_argument("--language", choices=("zh-CN", "en"))
    parser.add_argument("--legacy-dir", type=Path, help="Optional local backup of the previous dashboard")
    args = parser.parse_args()
    source = JournalSource(args.repo, args.language)
    server = JournalServer(("127.0.0.1", args.port), source, args.legacy_dir)
    print(f"Read-only journal preview: http://127.0.0.1:{server.server_address[1]}/journal", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
