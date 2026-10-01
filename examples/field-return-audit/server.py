"""仅监听本机的中文离线验收入口，使用 Python 标准库。"""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from audit import MAX_BYTES, audit, demo_request

ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = MAX_BYTES * 4 // 3 + 1024 * 1024
MAX_BODY_BYTES = MAX_REQUEST_BYTES
STATIC = {'/': ('index.html', 'text/html; charset=utf-8'),
          '/index.html': ('index.html', 'text/html; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
          '/icon.svg': ('icon.svg', 'image/svg+xml'),
          '/auto-company-icon.svg': ('auto-company-icon.svg', 'image/svg+xml')}


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler):
        super().__init__(address, handler)
        self.audit_slots = threading.BoundedSemaphore(2)


class Handler(BaseHTTPRequestHandler):
    server_version = 'FieldReturnAudit/1.0'
    sys_version = ''

    def log_message(self, format, *args):
        # 不记录文件内容、任务名称或请求参数。
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def _send(self, code, data, content_type='application/json; charset=utf-8'):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _error(self, code, message):
        self._send(code, {'error': message})

    def _local(self):
        host = self.headers.get('Host', '')
        accepted = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.server.server_port == 80:
            accepted.update(('127.0.0.1', 'localhost'))
        if host not in accepted:
            self._error(403, '仅允许通过本机地址访问此服务。')
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in {'http://' + host}:
            self._error(403, '不接受其他网站发起的请求，请从本机入口操作。')
            return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self._error(403, '不接受跨站请求，请从本机入口操作。')
            return False
        return True

    def do_GET(self):
        if not self._local():
            return
        path = urlsplit(self.path).path
        if path == '/api/health':
            self._send(200, {'status': 'ok', 'status_label': '本地服务可用'})
        elif path == '/api/demo':
            self._send(200, demo_request())
        elif path in STATIC:
            filename, mime = STATIC[path]
            file = ROOT / filename
            if not file.is_file():
                self._error(404, '入口文件尚未准备好。')
            else:
                self._send(200, file.read_bytes(), mime)
        else:
            self._error(404, '此路径不存在。')

    def do_POST(self):
        if not self._local():
            return
        if urlsplit(self.path).path != '/api/audit':
            self._error(404, '此接口不存在。')
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            self._error(415, '请使用 JSON 提交验收输入。')
            return
        if self.headers.get('Transfer-Encoding'):
            self._error(400, '请使用明确的内容长度提交请求。')
            return
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self._error(400, '请求缺少有效的内容长度。')
            return
        if length <= 0:
            self._error(400, '验收请求不可为空。')
            return
        if length > MAX_REQUEST_BYTES:
            self._error(413, '上传内容过大，文件合计上限为 100 MB。')
            return
        if not self.server.audit_slots.acquire(blocking=False):
            self._error(429, '本机正在处理其他验收，请稍后重试。')
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError('请求未完整传输，请重新提交。')
            try:
                payload = json.loads(body.decode('utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('JSON 不可包含非有限数字。')))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError('JSON 内容无效，请检查配置格式。') from None
            self._send(200, audit(payload))
        except ValueError as exc:
            self._error(400, str(exc))
        except (TimeoutError, ConnectionError, OSError):
            self._error(400, '读取请求失败或处理超时，请缩小批次并重试。')
        except (RecursionError, MemoryError):
            self._error(400, '输入结构过深或过大，请缩小批次并重试。')
        except Exception:
            self._error(500, '本地验收发生意外错误，请核对文件后重试；原件未修改。')
        finally:
            self.server.audit_slots.release()

    def do_OPTIONS(self):
        self._error(403, '此本地服务不开放跨站访问。')

    def send_error(self, code, message=None, explain=None):
        self._error(code, '请求方法或格式不受支持。')


def create_server(host='127.0.0.1', port=0):
    if host != '127.0.0.1':
        raise ValueError('服务仅允许绑定 127.0.0.1。')
    return LocalServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser(description='启动本机离线采集往返验收入口')
    parser.add_argument('--port', type=int, default=8765, help='本机端口，0 表示自动选择空闲端口（默认 8765）')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('端口必须介于 0 和 65535。')
    try:
        server = create_server(port=args.port)
    except OSError:
        parser.exit(1, '端口不可用，请使用 --port 0 自动选择本机端口。\n')
    print(f'本地验收入口：http://127.0.0.1:{server.server_port}（按 Ctrl+C 关闭）', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n本地服务已关闭。', flush=True)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
