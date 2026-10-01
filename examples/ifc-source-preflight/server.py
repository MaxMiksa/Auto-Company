"""仅监听本机的 IFC 预检工作台；上传内容仅在请求内存中处理。"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import ifcopenshell
from preflight import MAX_FILE_BYTES, PreflightError, analyze

ROOT = Path(__file__).resolve().parent
CASES = [
    ('normal', '正常数量变化', '同一对象 2 → 3 m³，完整数量差 +1。'),
    ('source-conflict', '同名来源冲突', '新版同一对象保留 3 与 7 两个来源，停止确定差量。'),
    ('missing', '新版缺数', '新版缺少 NetVolume，已知小计与完整性分开。'),
    ('units', '长度毫米、体积立方米', '显式体积单位优先，不将长度单位立方误用于体积。'),
    ('material-only', '仅更换材料', '总量不变，Concrete 减少、Timber 增加。'),
    ('swap', '对象互换材料', '总量不变，按两版原材料分别归属。'),
    ('guid-rebuilt', 'GUID 重建', '不凭名称猜测对象身份，仍可查看版本级已知小计。'),
    ('ambiguous', '重复名称、身份不明', '相同名称和 Tag 不作为可靠匹配依据。'),
    ('name-only', '仅修改名称', 'GUID 不变且数量不变。'),
    ('unchanged', '无数量变化', '同版对照，核对来源完整性。'),
]


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        for key, header in [('AUTO_COMPANY_MEDIA_TOKEN', 'X-Auto-Company-Media'),
                            ('AUTO_COMPANY_MEDIA_VERSION', 'X-Auto-Company-Version')]:
            if os.environ.get(key):
                self.send_header(header, os.environ[key])
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        super().end_headers()

    def reply(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == '/api/health':
            return self.reply(200, {'ok': True, 'parser': 'IfcOpenShell', 'version': ifcopenshell.version})
        if url.path == '/api/demo':
            query = parse_qs(url.query)
            case = query.get('case', [None])[0]
            if case is None:
                return self.reply(200, {'cases': [{'id': key, 'label': label, 'description': description} for key, label, description in CASES]})
            if case not in {item[0] for item in CASES}:
                return self.reply(400, {'error': '未知示例，请选择列表中的合成情境。'})
            payload = {version: {'name': f'合成-{case}-{version}.ifc',
                                 'content': (ROOT / 'examples' / case / f'{version}.ifc').read_text(encoding='utf-8')}
                       for version in ['old', 'new']}
            return self.reply(200, {**payload, 'element_type': 'IfcElement', 'quantity_name': 'NetVolume', 'synthetic': True})
        # 仅允许明确列出的界面资源与示例，不暴露源码或本地文件。
        requested = unquote(url.path)
        if requested in ('/', '/index.html'):
            resource = ROOT / 'index.html'
        elif requested in ('/app.js', '/styles.css', '/style.css', '/icon.svg', '/auto-company-icon.svg'):
            resource = ROOT / requested.lstrip('/')
        else:
            return self.reply(404, {'error': '页面不存在。'})
        if not resource.is_file():
            return self.reply(404, {'error': '页面资源尚未准备好。'})
        content = resource.read_bytes()
        media = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                 '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}[resource.suffix]
        self.send_response(200)
        self.send_header('Content-Type', media)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if urlsplit(self.path).path != '/api/analyze':
            return self.reply(404, {'error': '接口不存在。'})
        # 拒绝来自外部网页的浏览器请求；不配置跨域访问。
        origin = self.headers.get('Origin')
        if origin and origin != f'http://127.0.0.1:{self.server.server_port}':
            return self.reply(403, {'error': '仅允许本机工作台发起分析。'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0:
                raise PreflightError('请求为空，请重新选择两份 IFC 文件。')
            # JSON 转义可能增大合法 20 MB 双文件请求体。
            if length > MAX_FILE_BYTES * 12 + 4096:
                return self.reply(413, {'error': '请求过大；每个 IFC 文件上限为 10 MB。'})
            self.connection.settimeout(30)
            payload = json.loads(self.rfile.read(length).decode('utf-8'),
                                 parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(payload, dict):
                raise PreflightError('请求格式错误，请重新选择文件。')
            old, new = payload.get('old'), payload.get('new')
            if not isinstance(old, dict) or not isinstance(new, dict):
                raise PreflightError('请提供旧版和新版两个 IFC 文件。')
            if any(not isinstance(item.get('name', ''), str) for item in (old, new)):
                raise PreflightError('文件名称格式错误。')
            report = analyze(old.get('content'), new.get('content'), old.get('name') or '旧版.ifc',
                             new.get('name') or '新版.ifc', payload.get('element_type', 'IfcElement'),
                             payload.get('quantity_name', 'NetVolume'))
            return self.reply(200, report)
        except PreflightError as exc:
            return self.reply(413 if '超过 10 MB' in str(exc) else 400, {'error': str(exc)})
        except (ValueError, UnicodeError, TimeoutError):
            return self.reply(400, {'error': '请求格式无效或读取超时，请重新选择文件后重试。'})
        except Exception:
            return self.reply(400, {'error': '该 IFC 来源无法完整解析，请重新导出或缩小范围后重试；未生成差量结论。'})

    def log_message(self, fmt, *args):
        # 不记录文件名称、内容、查询参数或请求体。
        print(f'本机工作台：{self.command} 状态 {args[1] if len(args) > 1 else "未知"}', flush=True)


def main():
    parser = argparse.ArgumentParser(description='在本机打开 IFC 数量来源预检工作台。')
    parser.add_argument('--port', type=int, default=8765, help='本机端口（默认 8765，0 自动选择空闲端口）')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('端口须在 0 至 65535 之间。')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        parser.exit(1, '无法启动：端口已占用，请使用 --port 其他端口。\n')
    print(f'IFC 数量来源预检：http://127.0.0.1:{server.server_port}（按 Ctrl+C 停止）', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n工作台已停止。', flush=True)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
