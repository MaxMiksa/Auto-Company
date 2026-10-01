"""生成合成示例文件，便于在本机实际上传；不会联系任何外部服务。"""
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit import demo_request


def main():
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / '合成巡检示例'
    destination.mkdir(parents=True, exist_ok=True)
    request = demo_request()
    for role in ('baseline', 'field', 'target'):
        item = request[role]
        (destination / item['name']).write_bytes(base64.b64decode(item['data']))
    for role in ('field', 'target'):
        for item in request[role + '_attachments']:
            path = destination / ('现场附件' if role == 'field' else '目标附件') / item['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(item['data']))
    (destination / '验收配置.json').write_text(json.dumps(request['config'], ensure_ascii=False, indent=2), encoding='utf-8')
    (destination / '请求示例.json').write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding='utf-8')
    print('合成示例已生成：' + str(destination.resolve()))


if __name__ == '__main__':
    main()
