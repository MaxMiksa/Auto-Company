"""仅监听 loopback 的本地产品入口，不上传或持久化 PDF。"""
import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from engine import ValidationError, check_batch, demo_payload

WEB_ROOT = Path(__file__).resolve().parent / "web"
MAX_REQUEST_BYTES = 36 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "DisclosureLocal/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format, *args):
        # 不记录输入、文件名、规则或发现的敏感内容。
        pass

    def _local_request(self):
        port = self.server.server_address[1]
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            allowed_hosts.update({"127.0.0.1", "localhost"})
        if self.headers.get("Host", "").casefold() not in allowed_hosts:
            self._json({"error": "只接受本机地址访问。"}, 403)
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in allowed_hosts}:
            self._json({"error": "拒绝其他网页来源的请求，请直接打开本地页面。"}, 403)
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self._json({"error": "拒绝跨站请求，请直接打开本地页面。"}, 403)
            return False
        return True

    def _headers(self, status, content_type, length):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()

    def _json(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def do_GET(self):
        if not self._local_request():
            return
        parsed = urlsplit(self.path)
        if parsed.path == "/api/demo":
            self._json(demo_payload())
            return
        if parsed.path == "/api/health":
            self._json({"status": "ok", "local_only": True})
            return
        decoded = unquote(parsed.path)
        if "\\" in decoded or "\x00" in decoded or any(part == ".." for part in decoded.split("/")):
            self._json({"error": "无效的页面路径。"}, 400)
            return
        target = (WEB_ROOT / (decoded.lstrip("/") or "index.html")).resolve()
        if not target.is_relative_to(WEB_ROOT.resolve()) or not target.is_file():
            self._json({"error": "未找到页面。"}, 404)
            return
        data = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type == "application/javascript":
            content_type += "; charset=utf-8"
        self._headers(200, content_type, len(data))
        self.wfile.write(data)

    def do_POST(self):
        if not self._local_request():
            return
        if urlsplit(self.path).path != "/api/check":
            self._json({"error": "未知操作。"}, 404)
            return
        if self.headers.get("Transfer-Encoding"):
            self._json({"error": "不支持分块请求。"}, 400)
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self._json({"error": "请求必须使用 application/json。"}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= MAX_REQUEST_BYTES:
                self._json({"error": "请求为空或超过本地 36 MB 请求限制。"}, 413)
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValidationError("请求内容不完整，请重新提交。")
            payload = json.loads(body)
            self._json(check_batch(payload, isolate=True))
        except ValidationError as error:
            self._json({"error": str(error)}, 400)
        except (ValueError, UnicodeError):
            self._json({"error": "JSON 格式无效，请检查输入后重试。"}, 400)
        except (TimeoutError, ConnectionError):
            self.close_connection = True
        except Exception:
            self._json({"error": "本地检查暂时失败，请重新提交；输入文件未写入磁盘。"}, 500)


def create_server(host="127.0.0.1", port=0):
    if host not in ("127.0.0.1", "localhost"):
        raise ValueError("只允许本机 loopback 监听地址。")
    return HTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description="启动披露文件双向验收本地页面。")
    parser.add_argument("--port", type=int, default=8765, help="本地端口，默认 8765")
    args = parser.parse_args()
    with create_server(port=args.port) as server:
        print(f"本地页面：http://127.0.0.1:{server.server_address[1]}（仅本机，不上传文件）", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
