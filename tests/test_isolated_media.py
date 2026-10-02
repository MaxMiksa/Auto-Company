"""Actual host capture entrypoint: renderer, preview code and children isolated."""
import http.server
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/core'))
from product_identity import get_identity
from product_media import atomic_json, capture_product, media_folder


@unittest.skipUnless(os.environ.get('AUTO_COMPANY_TEST_PRODUCT_MEDIA_BROWSER') == '1',
                     'Enable real Chromium and namespace acceptance explicitly')
class IsolatedMediaTests(unittest.TestCase):
    def test_host_capture_blocks_other_project_environment_and_local_service(self):
        with tempfile.TemporaryDirectory(prefix='media-host-boundary-') as folder:
            root = Path(folder)
            project = root / 'projects/current'
            other = root / 'other-project'
            project.mkdir(parents=True)
            other.mkdir()
            canary = secrets.token_bytes(64)
            forbidden = other / 'canary'
            forbidden.write_bytes(canary)

            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(canary)
                def log_message(self, *_args):
                    pass

            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}/canary'
            try:
                self.assertEqual(urllib.request.urlopen(url, timeout=2).read(), canary)
                script = '''const fs=require('node:fs'),http=require('node:http'),cp=require('node:child_process');
const target=TARGET,hostURL=HOST_URL;
try { fs.readFileSync(target); throw new Error('outside file accessible'); }
catch(error) { if(error.message==='outside file accessible') throw error; }
if(process.env.SYNTHETIC_OTHER_PROJECT_SECRET) throw new Error('host environment inherited');
const code='from pathlib import Path; assert not Path('+JSON.stringify(target)+').exists()';
cp.execFileSync('/usr/bin/python3',['-c',code]);
fs.writeFileSync('preview-side-effect','namespace only');
const request=http.get(hostURL,()=>{throw new Error('host service accessible');});
request.on('error',()=>{
 const server=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html','X-Auto-Company-Media':process.env.AUTO_COMPANY_MEDIA_TOKEN,'X-Auto-Company-Version':process.env.AUTO_COMPANY_MEDIA_VERSION});
  res.end('<!doctype html><html><body><main style="font:28px sans-serif;padding:50px"><h1>Isolated project preview</h1><p>Current product and its child process work.</p></main></body></html>');
 });
 server.listen(Number(process.argv[2]),'127.0.0.1');
});
request.setTimeout(2000,()=>request.destroy());
'''.replace('TARGET', json.dumps(str(forbidden))).replace('HOST_URL', json.dumps(url))
                (project / 'preview.cjs').write_text(script)
                (project / 'index.html').write_text('<!doctype html><main>Current product</main>')
                atomic_json(project / '.auto-company/media.json', {
                    'version':1, 'type':'node', 'command':['node','preview.cjs','{port}'],
                    'healthPath':'/', 'readySelector':'main', 'timeoutSeconds':5})
                product = get_identity(root, 'projects/current', create=True)
                with patch.dict(os.environ, {'SYNTHETIC_OTHER_PROJECT_SECRET':'synthetic-secret'}):
                    record = capture_product(root, 'projects/current', 'isolation-acceptance')
                self.assertEqual(record['attempt']['state'], 'success', record['attempt'])
                self.assertFalse((project / 'preview-side-effect').exists())
                self.assertEqual(forbidden.read_bytes(), canary)
                self.assertEqual(urllib.request.urlopen(url, timeout=2).read(), canary)
                media = media_folder(root, product['id'])
                self.assertEqual(len(record['latestSuccess']['variants']), 2)
                for variant in record['latestSuccess']['variants']:
                    self.assertGreater((media / variant['name']).stat().st_size, 3000)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
