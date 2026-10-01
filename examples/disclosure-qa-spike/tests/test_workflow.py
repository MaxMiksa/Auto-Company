"""使用真实合成 PDF 检查双向规则与本机 HTTP，不执行历史实验。"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import os
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pymupdf as pdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SECRET = "SYNTH-SECRET-472819"
PUBLIC = "PUBLIC-DECISION-8462"
ZH_SECRET = "合成保密编号七二九"
ZH_PUBLIC = "应保留结论：本批次批准公开事项"


def make_pdf(*, secret=False, public=True, chinese=False, layer=None):
    """每个场景即时生成 PDF 字节，避免固定展示数据伪装成检查。"""
    doc = pdf.open()
    page = doc.new_page(width=595, height=842)
    value = ZH_SECRET if chinese else SECRET
    retained = ZH_PUBLIC if chinese else PUBLIC
    font = "china-s" if chinese else "helv"
    if secret:
        page.insert_text((72, 110), value, fontname=font, fontsize=12)
    if public:
        page.insert_text((72, 180), retained, fontname=font, fontsize=12)
    if layer == "cover":
        page.draw_rect(pdf.Rect(65, 90, 400, 120), fill=(0, 0, 0), overlay=True)
    elif layer == "metadata":
        doc.set_metadata({"author": value})
    elif layer == "annotation":
        page.add_text_annot((72, 240), value)
    elif layer == "unapplied":
        page.add_redact_annot(pdf.Rect(65, 90, 400, 120))
    elif layer == "attachment":
        doc.embfile_add("synthetic.txt", value.encode("utf-8"), filename="synthetic.txt")
    elif layer == "scan":
        image = page.get_pixmap().tobytes("png")
        doc.close()
        doc = pdf.open()
        doc.new_page(width=595, height=842).insert_image(pdf.Rect(0, 0, 595, 842), stream=image)
    if layer == "encrypted":
        data = doc.tobytes(encryption=pdf.PDF_ENCRYPT_AES_256,
                           user_pw="合成密码", owner_pw="synthetic-owner")
    else:
        data = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return data


def encoded_file(name, data):
    return {"name": name, "data": base64.b64encode(data).decode("ascii")}


def incremental_pdf():
    """当前页面已脱敏，旧增量版本仍保留原内容。"""
    with tempfile.TemporaryDirectory(prefix="disclosure-qa-fixture-") as folder:
        path = Path(folder) / "incremental.pdf"
        path.write_bytes(make_pdf(secret=True))
        with pdf.open(path) as doc:
            doc[0].add_redact_annot(pdf.Rect(65, 90, 400, 120))
            doc[0].apply_redactions()
            doc.saveIncr()
        return path.read_bytes()


def payload_for(*files, chinese=False):
    return {"batch_name": "合成检查批次", "rules": {
        "version": "合成规则-v1", "approved_by": "合成批准人",
        "remove": [ZH_SECRET if chinese else SECRET],
        "retain": [ZH_PUBLIC if chinese else PUBLIC]}, "files": list(files)}


class CoreFlowTests(unittest.TestCase):
    def check(self, *files, chinese=False):
        from engine import check_batch
        return check_batch(payload_for(*files, chinese=chinese))

    def test_clean_pdf_retains_fact_and_does_not_claim_certification(self):
        data = make_pdf()
        report = self.check(encoded_file("clean.pdf", data))
        result = report["files"][0]
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertFalse([item for item in result["findings"] if item["kind"] in ("remove", "retain")])
        self.assertTrue([item for item in result["coverage"] if item["status"] == "manual"])
        self.assertEqual(report["summary"]["review"], 1)
        self.assertEqual(report["summary"]["checked"], 0)

    def test_black_cover_cannot_hide_extractable_secret(self):
        result = self.check(encoded_file("cover.pdf", make_pdf(secret=True, layer="cover")))["files"][0]
        self.assertEqual(result["status"], "issues")
        self.assertTrue(any(item["kind"] == "remove" and item["location"] == "页面文本"
                            for item in result["findings"]))

    def test_chinese_remove_and_retain_are_both_matched(self):
        clean = encoded_file("中文正确.pdf", make_pdf(chinese=True))
        leak = encoded_file("中文泄漏.pdf", make_pdf(secret=True, chinese=True))
        results = self.check(clean, leak, chinese=True)["files"]
        self.assertEqual([item["status"] for item in results], ["review", "issues"])
        self.assertFalse(any(item["kind"] == "retain" for item in results[0]["findings"]))
        self.assertTrue(any(item["kind"] == "remove" for item in results[1]["findings"]))

    def test_secret_in_other_pdf_layers_is_not_ignored(self):
        for layer, location in [("metadata", "元数据"), ("annotation", "批注"),
                                ("attachment", "附件可读文本")]:
            with self.subTest(layer=layer):
                result = self.check(encoded_file(layer + ".pdf", make_pdf(layer=layer)))["files"][0]
                self.assertEqual(result["status"], "issues")
                self.assertTrue(any(item["kind"] == "remove" and item["location"] == location
                                    for item in result["findings"]))

    def test_unapplied_redaction_still_exposes_secret(self):
        result = self.check(encoded_file("unapplied.pdf", make_pdf(secret=True, layer="unapplied")))["files"][0]
        self.assertEqual(result["status"], "issues")
        self.assertTrue(any(item["kind"] == "remove" for item in result["findings"]))

    def test_unapplied_redaction_requires_rework_even_without_rule_match(self):
        result = self.check(encoded_file("pending-redaction.pdf", make_pdf(layer="unapplied")))["files"][0]
        self.assertEqual(result["status"], "issues")
        self.assertTrue(any(item["kind"] == "coverage" and item["severity"] == "error"
                            for item in result["findings"]))

    def test_missing_retained_fact_is_an_error(self):
        data = make_pdf(public=False)
        # 保留非空可检标题，区分可检文本过删和完全不可检的扫描件。
        with pdf.open(stream=data, filetype="pdf") as doc:
            doc[0].insert_text((72, 60), "SYNTHETIC REPORT")
            data = doc.tobytes()
        result = self.check(encoded_file("overdeleted.pdf", data))["files"][0]
        self.assertEqual(result["status"], "issues")
        self.assertTrue(any(item["kind"] == "retain" and item["severity"] == "error"
                            for item in result["findings"]))

    def test_scan_does_not_become_a_clean_or_overdelete_certification(self):
        result = self.check(encoded_file("scan.pdf", make_pdf(secret=True, layer="scan")))["files"][0]
        self.assertEqual(result["status"], "review")
        self.assertTrue(any(item["id"] == "visual-ocr" and item["status"] == "manual"
                            for item in result["coverage"]))
        self.assertTrue(any(item["kind"] == "retain" and item["severity"] == "warning"
                            for item in result["findings"]))

    def test_incremental_history_is_never_marked_fully_checked(self):
        result = self.check(encoded_file("incremental.pdf", incremental_pdf()))["files"][0]
        self.assertIn(result["status"], ("issues", "review"))
        self.assertTrue(any(item["id"] == "old-revisions" and item["status"] == "manual"
                            for item in result["coverage"]))

    def test_hashes_bind_exact_file_and_rule_revision(self):
        first = payload_for(encoded_file("file.pdf", make_pdf()))
        from engine import check_batch
        old = check_batch(first)
        same = check_batch(copy.deepcopy(first))
        self.assertEqual(old["rule_hash"], same["rule_hash"])
        self.assertEqual(old["files"][0]["sha256"], same["files"][0]["sha256"])
        modified = copy.deepcopy(first)
        modified["rules"]["version"] = "合成规则-v2"
        self.assertNotEqual(old["rule_hash"], check_batch(modified)["rule_hash"])
        modified = copy.deepcopy(first)
        modified["files"][0] = encoded_file("file.pdf", make_pdf(secret=True))
        self.assertNotEqual(old["files"][0]["sha256"], check_batch(modified)["files"][0]["sha256"])

    def test_rule_whitespace_width_and_case_normalization(self):
        from engine import check_batch
        payload = payload_for(encoded_file("normalized.pdf", make_pdf(secret=True)))
        payload["rules"]["remove"] = ["ｓｙｎｔｈ－ｓｅｃｒｅｔ－４７２８１９"]
        payload["rules"]["retain"] = [" public- decision-8462 "]
        result = check_batch(payload)["files"][0]
        self.assertEqual(result["status"], "issues")
        self.assertFalse(any(item["kind"] == "retain" for item in result["findings"]))


class FailureRecoveryTests(unittest.TestCase):
    def test_invalid_files_are_isolated_and_can_be_replaced(self):
        from engine import check_batch
        payload = payload_for(encoded_file("good.pdf", make_pdf()),
                              encoded_file("broken.pdf", b"%PDF-1.7\nnot a real pdf"),
                              encoded_file("locked.pdf", make_pdf(layer="encrypted")),
                              {"name": "invalid.pdf", "data": "!invalid-base64!"})
        results = check_batch(payload)["files"]
        self.assertEqual([item["status"] for item in results], ["review", "error", "error", "error"])
        self.assertTrue(all(item["error"] for item in results[1:]))
        payload["files"] = [encoded_file("fixed.pdf", make_pdf())]
        self.assertEqual(check_batch(payload)["files"][0]["status"], "review")

    def test_conflicting_duplicate_or_empty_rules_are_rejected(self):
        from engine import check_batch, ValidationError
        base = payload_for(encoded_file("file.pdf", make_pdf()))
        cases = [{"remove": [SECRET], "retain": [SECRET]},
                 {"remove": [SECRET], "retain": ["PREFIX-" + SECRET]},
                 {"remove": [SECRET, SECRET.lower()], "retain": [PUBLIC]},
                 {"remove": ["   "], "retain": [PUBLIC]},
                 {"remove": [], "retain": [PUBLIC]},
                 {"remove": [SECRET], "retain": "not a list"}]
        for update in cases:
            with self.subTest(update=update):
                payload = copy.deepcopy(base)
                payload["rules"].update(update)
                with self.assertRaises(ValidationError):
                    check_batch(payload)

    def test_input_types_names_and_boundary_lengths(self):
        from engine import check_batch, ValidationError
        base = payload_for(encoded_file("file.pdf", make_pdf()))
        cases = [None, [], {}, {**base, "files": []}, {**base, "batch_name": "x" * 181},
                 {**base, "batch_name": "bad\nname"}, {**base, "files": [None]}]
        for name in ("../file.pdf", "dir/file.pdf", "dir\\file.pdf", ".."):
            cases.append({**base, "files": [encoded_file(name, make_pdf())]})
        duplicate = copy.deepcopy(base)
        duplicate["files"].append({**duplicate["files"][0], "name": "FILE.PDF"})
        cases.append(duplicate)
        too_long_rule = copy.deepcopy(base)
        too_long_rule["rules"]["remove"] = ["x" * 301]
        cases.append(too_long_rule)
        too_many_files = copy.deepcopy(base)
        too_many_files["files"] = [{**base["files"][0], "name": f"{index}.pdf"} for index in range(21)]
        cases.append(too_many_files)
        for index, payload in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(ValidationError):
                check_batch(payload)
        accepted = copy.deepcopy(base)
        accepted["batch_name"] = "x" * 180
        accepted["rules"]["remove"] = ["x" * 300]
        self.assertEqual(check_batch(accepted)["files"][0]["status"], "review")

    def test_file_page_limit_is_isolated(self):
        from engine import check_batch
        with pdf.open() as doc:
            for _ in range(201):
                doc.new_page(width=72, height=72)
            data = doc.tobytes()
        payload = payload_for(encoded_file("too-many-pages.pdf", data), encoded_file("good.pdf", make_pdf()))
        self.assertEqual([item["status"] for item in check_batch(payload)["files"]], ["error", "review"])

    def test_file_size_limit_and_non_text_data_are_isolated(self):
        from engine import check_batch, MAX_FILE_BYTES
        oversized = base64.b64encode(b"%PDF-1.7\n" + b" " * MAX_FILE_BYTES).decode("ascii")
        payload = payload_for({"name": "too-large.pdf", "data": oversized},
                              {"name": "wrong-type.pdf", "data": None},
                              encoded_file("good.pdf", make_pdf()))
        self.assertEqual([item["status"] for item in check_batch(payload)["files"]],
                         ["error", "error", "review"])

    def test_excessive_findings_cannot_export_as_complete_inspection(self):
        from engine import check_batch
        secrets = [f"SYNTH-MARK-{index:03d}" for index in range(100)]
        with pdf.open() as doc:
            for _ in range(5):
                page = doc.new_page(width=595, height=842)
                available = page.insert_textbox(pdf.Rect(30, 30, 550, 810),
                                                "\n".join([PUBLIC, *secrets]), fontsize=5)
                self.assertGreaterEqual(available, 0, "合成PDF必须真正容纳并写入所有检查标记")
                extracted = page.get_text()
                self.assertIn(secrets[0], extracted)
                self.assertIn(secrets[-1], extracted)
            data = doc.tobytes()
        payload = payload_for(encoded_file("many-findings.pdf", data), encoded_file("good.pdf", make_pdf()))
        payload["rules"]["remove"] = secrets
        results = check_batch(payload)["files"]
        self.assertEqual([item["status"] for item in results], ["error", "review"])
        self.assertIn("400", results[0]["error"])


class HttpWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from server import create_server
        cls.server = create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, path, payload=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
        headers = {"Content-Type": "application/json", **(headers or {})}
        request = Request(self.url + path, data=data, headers=headers)
        try:
            # 显式直连回环服务，防止系统代理按攻击Host头将测试转发到外部。
            with build_opener(ProxyHandler({})).open(request, timeout=45) as response:
                return response.status, response.headers, response.read()
        except HTTPError as response:
            return response.code, response.headers, response.read()

    def test_actual_http_check_returns_per_file_results(self):
        payload = payload_for(encoded_file("good.pdf", make_pdf()), encoded_file("leak.pdf", make_pdf(secret=True)))
        status, headers, body = self.request("/api/check", payload)
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers["Content-Type"])
        report = json.loads(body)
        self.assertEqual([item["status"] for item in report["files"]], ["review", "issues"])

    def test_http_invalid_json_and_rules_are_recoverable(self):
        self.assertEqual(self.request("/api/check", raw=b"{broken json")[0], 400)
        self.assertEqual(self.request("/api/check", {"batch_name": "bad"})[0], 400)
        self.assertEqual(self.request("/api/health")[0], 200)

    def test_remote_origin_rejected_before_processing(self):
        payload = payload_for(encoded_file("file.pdf", make_pdf()))
        status, _, _ = self.request("/api/check", payload, {"Origin": "https://attacker.invalid"})
        self.assertEqual(status, 403)
        status, _, _ = self.request("/api/check", payload, {"Origin": self.url})
        self.assertEqual(status, 200)

    def test_http_host_cross_site_and_content_type_boundaries(self):
        payload = payload_for(encoded_file("file.pdf", make_pdf()))
        self.assertEqual(self.request("/api/check", payload, {"Host": "attacker.invalid"})[0], 403)
        self.assertEqual(self.request("/api/check", payload, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("/api/check", payload, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/unknown", payload)[0], 404)

    def test_http_mixed_bad_pdf_keeps_valid_result(self):
        payload = payload_for(encoded_file("bad.pdf", b"%PDF-1.7\nbroken"),
                              encoded_file("good.pdf", make_pdf()))
        status, _, body = self.request("/api/check", payload)
        self.assertEqual(status, 200)
        self.assertEqual([item["status"] for item in json.loads(body)["files"]], ["error", "review"])

    def test_static_entry_and_private_paths(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("披露".encode(), body)
        for path in ("/../engine.py", "/%2e%2e/engine.py", "/engine.py", "/.git/config", "/DELIVERY.md"):
            with self.subTest(path=path):
                self.assertIn(self.request(path)[0], (400, 403, 404))


class BrowserWorkflowTests(unittest.TestCase):
    """真实本机页面检查；浏览器依赖缺失会失败，不跳过验收。"""
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        from server import create_server
        cls.server = create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch(
                headless=True,
                **({"executable_path": os.environ["BROWSER_EXECUTABLE_PATH"]}
                   if os.environ.get("BROWSER_EXECUTABLE_PATH") else {}),
            )
        except Exception:
            cls.playwright.stop()
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join(timeout=5)
            raise
        cls.evidence = Path(os.environ.get("BROWSER_EVIDENCE_DIR", ROOT / "test-results" / "browser-evidence"))
        cls.evidence.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(self.url, wait_until="networkidle")
        self.page.wait_for_selector("#run-check")

    def tearDown(self):
        self.context.close()

    def enter_rules(self, *, batch_name="合成浏览器验收批次"):
        self.page.locator("#batch-name").fill(batch_name)
        self.page.locator("#rule-version").fill("合成规则-v1")
        self.page.locator("#approved-by").fill("合成批准人")
        self.page.locator("#remove-rules").fill(SECRET)
        self.page.locator("#retain-rules").fill(PUBLIC)

    def upload(self, *files):
        self.page.locator("#pdf-files").set_input_files([
            {"name": name, "mimeType": "application/pdf", "buffer": data} for name, data in files])

    def run_check(self):
        with self.page.expect_response(lambda response: response.url.endswith("/api/check"), timeout=45000) as pending:
            self.page.locator("#run-check").click()
        response = pending.value
        self.assertEqual(response.status, 200)
        report = response.json()
        self.page.locator("#result-panel").wait_for(state="visible")
        return report

    def download(self, selector, destination):
        with self.page.expect_download() as pending:
            self.page.locator(selector).click()
        pending.value.save_as(destination)
        return Path(destination).read_text(encoding="utf-8")

    def confirm_all(self, note="合成测试复核备注：已按覆盖边界人工核对。"):
        items = self.page.locator(".finding")
        self.assertGreater(items.count(), 0)
        for index in range(items.count()):
            item = items.nth(index)
            item.locator("select").select_option("confirmed")
            item.locator("textarea").fill(f"{note} 第 {index + 1} 项。")

    def test_real_upload_review_export_reuse_and_version_invalidation(self):
        from playwright.sync_api import expect

        self.enter_rules()
        data = make_pdf()
        self.upload(("合成干净.pdf", data))
        report = self.run_check()
        self.assertEqual(report["files"][0]["status"], "review")
        self.assertEqual(report["files"][0]["sha256"], hashlib.sha256(data).hexdigest())
        self.page.get_by_role("button", name="预览原 PDF", exact=True).click()
        self.page.locator("#preview-dialog").wait_for(state="visible")
        self.assertIn("blob:", self.page.locator("#preview-download").get_attribute("href"))
        self.page.locator("#close-preview").click()
        # 空备注不能完成交接；单纯选“已确认”不够。
        for item in self.page.locator(".finding select").all():
            item.select_option("confirmed")
        self.assertIn("等待", self.page.locator("#handoff-status").inner_text())
        self.confirm_all()
        self.assertIn("可交接", self.page.locator("#handoff-status").inner_text())
        self.assertIn("非安全认证", self.page.locator("#handoff-status").inner_text())
        self.page.locator("#review-filter").select_option("pending")
        self.assertEqual(self.page.locator(".finding:visible").count(), 0)
        self.page.locator("#review-filter").select_option("all")
        record = json.loads(self.download("#export-json", self.evidence / "clean-report.json"))
        self.assertEqual(record["handoff"]["status"], "ready")
        self.assertEqual(record["rule_hash"], report["rule_hash"])
        self.assertEqual(record["files"][0]["sha256"], report["files"][0]["sha256"])
        self.assertEqual(record["handoff"]["completed"], len(record["human_review"]))
        self.assertTrue(all(item["note"].strip() for item in record["human_review"].values()))
        html = self.download("#export-html", self.evidence / "clean-report.html")
        self.assertIn(record["rule_hash"], html)
        self.assertIn(record["files"][0]["sha256"], html)
        self.assertIn("合成测试复核备注", html)
        self.assertIn("不能证明未覆盖", html)
        self.page.screenshot(path=str(self.evidence / "desktop.png"), full_page=True)
        rules_path = self.evidence / "reusable-rules.json"
        rule_record = json.loads(self.download("#export-rules", rules_path))
        self.assertEqual(rule_record["rules"], report["rules"])
        self.page.locator("#remember-session").check()
        self.page.reload(wait_until="networkidle")
        self.assertIn("可交接", self.page.locator("#handoff-status").inner_text())
        self.assertIn("恢复的报告不包含 PDF", self.page.locator("#file-results").inner_text())
        # 规则导入恢复可复用输入，报告和复核仍需重新生成。
        self.page.locator("#rule-version").fill("合成规则-v2")
        self.assertFalse(self.page.locator("#result-panel").is_visible())
        self.page.locator("#rule-file").set_input_files(str(rules_path))
        # file.text()异步读取完成后才会更新规则，等待真实UI状态而非固定延时。
        expect(self.page.locator("#rule-version")).to_have_value(report["rules"]["version"])
        self.assertEqual(self.page.locator("#rule-version").input_value(), report["rules"]["version"])
        self.assertFalse(self.page.locator("#result-panel").is_visible())
        self.page.locator("#rule-version").fill("合成规则-v2")
        self.upload(("合成干净.pdf", data))
        revised = self.run_check()
        self.assertNotEqual(revised["rule_hash"], report["rule_hash"])
        self.assertTrue(all(item.input_value() == "pending" for item in self.page.locator(".finding select").all()))
        self.assertTrue(all(not item.input_value() for item in self.page.locator(".finding textarea").all()))
        # 文件字节改变也使旧复核失效，且返回新指纹和真实漏删。
        self.page.locator("#clear-files").click()
        self.assertFalse(self.page.locator("#result-panel").is_visible())
        self.upload(("合成干净.pdf", make_pdf(secret=True)))
        replaced = self.run_check()
        self.assertNotEqual(replaced["files"][0]["sha256"], report["files"][0]["sha256"])
        self.assertEqual(replaced["files"][0]["status"], "issues")
        self.confirm_all()
        self.assertIn("需修复", self.page.locator("#handoff-status").inner_text())
        self.assertEqual(self.errors, [])

    def test_invalid_input_recovers_and_xss_is_text_on_narrow_screen(self):
        self.page.set_viewport_size({"width": 375, "height": 900})
        marker = "<script>window.__qa_xss=1</script>"
        name = "<img src=x onerror=window.__qa_xss=1>.pdf"
        self.enter_rules(batch_name="合成批次 " + marker)
        self.upload((name, make_pdf()), ("合成泄漏.pdf", make_pdf(secret=True)),
                    ("合成坏文件.pdf", b"%PDF-1.7\nnot-valid"))
        # 前端规则矛盾产生可读错误，修正后仍可使用原文件。
        self.page.locator("#retain-rules").fill(SECRET)
        self.page.locator("#run-check").click()
        self.assertIn("矛盾", self.page.locator("#notice").inner_text())
        self.assertFalse(self.page.locator("#result-panel").is_visible())
        self.page.locator("#retain-rules").fill(PUBLIC)
        report = self.run_check()
        self.assertEqual([item["status"] for item in report["files"]], ["review", "issues", "error"])
        self.assertIn(name, self.page.locator("#file-results").inner_text())
        self.assertIn(marker, self.page.locator("#report-title").inner_text())
        self.assertEqual(self.page.locator("#report-title script, #file-results img").count(), 0)
        self.assertIsNone(self.page.evaluate("window.__qa_xss"))
        self.confirm_all(note="合成复核备注 " + marker)
        self.assertIn("需修复", self.page.locator("#handoff-status").inner_text())
        record = json.loads(self.download("#export-json", self.evidence / "issues-report.json"))
        self.assertEqual(record["handoff"]["status"], "pending")
        html = self.download("#export-html", self.evidence / "issues-report.html")
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
        printed = self.context.new_page()
        printed.set_content(html)
        self.assertEqual(printed.locator("script").count(), 0)
        self.assertIsNone(printed.evaluate("window.__qa_xss"))
        self.assertIn(marker, printed.locator("body").inner_text())
        printed.close()
        overflow = self.page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        self.assertLessEqual(overflow, 1, f"窄屏存在横向溢出 {overflow}px")
        self.page.screenshot(path=str(self.evidence / "narrow.png"), full_page=True)
        self.assertEqual(self.errors, [])

    def test_scan_warning_requires_explicit_visual_review_and_remains_non_certification(self):
        self.enter_rules(batch_name="合成扫描件人工核对流程")
        self.upload(("合成扫描.pdf", make_pdf(layer="scan")))
        report = self.run_check()
        self.assertEqual(report["files"][0]["status"], "review")
        self.assertTrue(any(item["kind"] == "retain" and item["severity"] == "warning"
                            for item in report["files"][0]["findings"]))
        self.assertIn("等待", self.page.locator("#handoff-status").inner_text())
        self.confirm_all(note="合成流程测试：已逐页视觉核对公开事实与未覆盖内容。")
        self.assertIn("可交接", self.page.locator("#handoff-status").inner_text())
        record = json.loads(self.download("#export-json", self.evidence / "scan-review.json"))
        self.assertEqual(record["handoff"]["status"], "ready")
        self.assertTrue(any(item["id"] == "visual-ocr" and item["status"] == "manual"
                            for item in record["files"][0]["coverage"]))
        self.assertIn("不代表文件安全认证", record["handoff"]["disclaimer"])
        self.assertEqual(self.errors, [])

    def test_same_name_size_and_timestamp_replacement_uses_new_file_bytes(self):
        self.enter_rules(batch_name="合成同名修复回归")
        first = make_pdf()
        second = make_pdf(secret=True)
        # PDF 允许尾部空白，补齐等长只改变文件元数据条件，不改检查结果。
        length = max(len(first), len(second))
        first += b" " * (length - len(first))
        second += b" " * (length - len(second))

        def select_fixed_metadata(data):
            self.page.locator("#pdf-files").evaluate("""(input, encoded) => {
                const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
                const file = new File([bytes], '同名修复.pdf',
                    {type: 'application/pdf', lastModified: 1700000000000});
                const transfer = new DataTransfer(); transfer.items.add(file);
                input.files = transfer.files;
                input.dispatchEvent(new Event('change', {bubbles: true}));
            }""", base64.b64encode(data).decode("ascii"))

        select_fixed_metadata(first)
        previous = self.run_check()
        self.assertEqual(previous["files"][0]["status"], "review")
        self.confirm_all()
        self.assertIn("可交接", self.page.locator("#handoff-status").inner_text())
        select_fixed_metadata(second)
        self.assertFalse(self.page.locator("#result-panel").is_visible())
        self.assertEqual(self.page.locator("#file-list li").count(), 1)
        current = self.run_check()
        self.assertEqual(current["files"][0]["status"], "issues")
        self.assertEqual(current["files"][0]["sha256"], hashlib.sha256(second).hexdigest())
        self.assertNotEqual(current["files"][0]["sha256"], previous["files"][0]["sha256"])
        self.assertTrue(all(item.input_value() == "pending" for item in self.page.locator(".finding select").all()))
        self.assertTrue(all(not item.input_value() for item in self.page.locator(".finding textarea").all()))
        self.assertEqual(self.errors, [])
