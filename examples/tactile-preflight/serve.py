"""仅在回环地址提供产品静态资源。按 Ctrl+C 退出。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse


class ProductHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        parts = Path(path).parts
        if any(part.startswith('.') or part == '..' for part in parts):
            self.send_error(404)
            return
        candidate = Path(self.directory) / path.lstrip('/')
        if candidate.is_dir() and path != '/':
            self.send_error(404)
            return
        if path != '/' and candidate.suffix.lower() not in {'.html', '.css', '.js', '.svg'}:
            self.send_error(404)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='触图审查台：本机启动，文件在浏览器本地处理。')
    parser.add_argument('--port', type=int, default=8765, help='本机端口，默认8765；0自动选择空闲端口')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('端口必须介于0和65535之间。')
    root = Path(__file__).resolve().parent
    try:
        with ThreadingHTTPServer(('127.0.0.1', args.port), partial(ProductHandler, directory=str(root))) as server:
            print(f'触图审查台：http://127.0.0.1:{server.server_port}/\n保持终端打开；按 Ctrl+C 退出。', flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止本机服务。')
    except OSError as error:
        parser.exit(1, f'无法启动本机服务：{error}。可使用 --port 0 选择空闲端口。\n')


if __name__ == '__main__':
    main()
