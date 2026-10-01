"""真实环回 HTTP 请求验证；不向外网发送模型。"""
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from preflight import MAX_FILE_BYTES
from server import Handler
from tests.fixtures import raw, single


class QuietHandler(Handler):
    def log_message(self, *_):
        pass


class HTTPBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=15)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = response.status, dict(response.getheaders()), payload
        connection.close()
        return result

    def post(self, payload, **headers):
        status, response_headers, body = self.request('POST', '/api/analyze', json.dumps(payload, ensure_ascii=False).encode('utf-8'), {'Content-Type': 'application/json', **headers})
        return status, response_headers, json.loads(body)

    def valid_payload(self):
        return {'old': {'name': '旧版.ifc', 'content': raw(single(2))}, 'new': {'name': '新版.ifc', 'content': raw(single(3))}, 'element_type': 'IfcElement', 'quantity_name': 'NetVolume'}


class CoreHTTPTests(HTTPBase):
    def test_actual_uploaded_ifc_contents_produce_complete_report(self):
        status, headers, report = self.post(self.valid_payload())
        self.assertEqual(status, 200)
        self.assertEqual(report['summary']['complete_delta_m3'], 1)
        self.assertEqual(report['sources'][0]['raw_value'], 2)
        self.assertEqual(report['sources'][1]['raw_value'], 3)
        self.assertIn('application/json', headers['Content-Type'])
        self.assertIn('no-store', headers['Cache-Control'])

    def test_public_local_examples_are_real_parseable_inputs(self):
        status, _, body = self.request('GET', '/api/demo')
        self.assertEqual(status, 200)
        self.assertTrue(any(case['id'] == 'source-conflict' for case in json.loads(body)['cases']))
        status, _, body = self.request('GET', '/api/demo?case=source-conflict')
        self.assertEqual(status, 200)
        demo = json.loads(body)
        self.assertTrue(demo['synthetic'])
        status, _, report = self.post(demo)
        self.assertEqual(status, 200)
        self.assertIsNone(report['summary']['complete_delta_m3'])
        self.assertEqual([row['raw_value'] for row in report['sources'] if row['version'] == 'new'], [3, 7])


class HTTPRecoveryTests(HTTPBase):
    def test_malformed_and_wrong_shape_then_successful_retry(self):
        status, _, body = self.request('POST', '/api/analyze', b'not-json', {'Content-Type': 'application/json'})
        self.assertEqual(status, 400)
        self.assertIn('error', json.loads(body))
        for payload in [[], None, {}, {'old': {'content': 'bad'}, 'new': {'content': 'bad'}}, {'old': 1, 'new': 2}]:
            with self.subTest(payload=payload):
                status, _, response = self.post(payload)
                self.assertEqual(status, 400)
                self.assertTrue(any('\u4e00' <= c <= '\u9fff' for c in response['error']))
        self.assertEqual(self.post(self.valid_payload())[0], 200)

    def test_over_limit_single_file_gets_413_and_can_retry(self):
        payload = self.valid_payload()
        payload['old']['content'] = 'x' * (MAX_FILE_BYTES + 1)
        status, _, error = self.post(payload)
        self.assertEqual(status, 413)
        self.assertIn('10 MB', error['error'])
        self.assertEqual(self.post(self.valid_payload())[0], 200)

    def test_cross_origin_request_rejected_same_origin_succeeds(self):
        payload = self.valid_payload()
        status, _, error = self.post(payload, Origin='https://untrusted.invalid')
        self.assertEqual(status, 403)
        self.assertIn('本机', error['error'])
        status, _, _ = self.post(payload, Origin=f'http://127.0.0.1:{self.server.server_port}')
        self.assertEqual(status, 200)

    def test_private_local_files_are_not_served(self):
        for path in ['/server.py', '/.git/config', '/.auto-company/delivery-plan.json', '/DELIVERY.md', '/%2e%2e/memories/consensus.md', '/api/demo?case=../../server.py']:
            with self.subTest(path=path):
                status, _, _ = self.request('GET', path)
                self.assertIn(status, [400, 404])
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'<!doctype html>', body.lower())
        self.assertIn("script-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')


if __name__ == '__main__':
    unittest.main()
