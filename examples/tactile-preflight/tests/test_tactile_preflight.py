"""触图审查台的真实浏览器验收；仅处理本地证据或构造输入。

由正式交付 runner 分别执行检查类；不访问外站、不发送表单。
"""

import functools
import http.server
import json
import os
from pathlib import Path
import threading
import unittest

from playwright.sync_api import sync_playwright


PRODUCT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("TACTILE_CHROMIUM_EXECUTABLE")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class BrowserCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = None
        cls.base = os.environ.get("TACTILE_PREVIEW_URL", "").rstrip("/")
        if not cls.base:
            handler = functools.partial(QuietHandler, directory=str(PRODUCT))
            cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
            cls.server_thread.start()
            cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.pw = sync_playwright().start()
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if CHROME:
            options["executable_path"] = CHROME
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        if cls.server:
            cls.server.shutdown()
            cls.server.server_close()
            cls.server_thread.join(timeout=3)

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.remote_requests = []

        def local_only(route):
            url = route.request.url
            if url.startswith(self.base + "/") or url.startswith("data:"):
                route.continue_()
            else:
                self.remote_requests.append(url)
                route.abort()

        self.context.route("**/*", local_only)
        self.page = self.context.new_page()
        self.page.set_default_timeout(7000)
        self.page.goto(self.base + "/", wait_until="networkidle")

    def tearDown(self):
        evidence = os.environ.get("TACTILE_EVIDENCE_DIR")
        if evidence:
            directory = Path(evidence)
            directory.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(directory / f"{self.id().split('.')[-1]}.png"), full_page=True)
        self.context.close()

    def source(self, relative):
        samples = {"geometry/label-before.svg": "label-before.svg", "tvl/named-crowded-tactile.svg": "tvl-crowded.svg", "tvl/recovered-clean-tactile.svg": "tvl-clean.svg"}
        return (PRODUCT / "samples" / samples[relative]).read_text(encoding="utf-8")

    def engine_import(self, source, width=None, height=None):
        return self.page.evaluate(
            """async ({source,width,height}) => {
                window.qaEngine = await import('./engine.js');
                let mount = document.querySelector('#qa-browser-mount');
                if (!mount) {
                    mount = document.createElement('div'); mount.id = 'qa-browser-mount';
                    mount.style.width = '800px'; document.body.append(mount);
                }
                window.qaDoc = await qaEngine.importSvg(source,mount,{widthMm:width,heightMm:height});
                return {
                    widthMm:qaDoc.widthMm, heightMm:qaDoc.heightMm,
                    scaleSource:qaDoc.scaleSource, warnings:qaDoc.warnings,
                    objects:qaDoc.objects.map(o => ({id:o.id,name:o.name,kind:o.kind,
                        association:o.association,box:o.box,markup:o.element.outerHTML})),
                    analysis:qaEngine.analyze(qaDoc)
                };
            }""",
            {"source": source, "width": width, "height": height},
        )

    def import_file(self, source, filename="fixture.svg"):
        self.page.locator("#svg-file").set_input_files(
            {"name": filename, "mimeType": "image/svg+xml", "buffer": source.encode()}
        )

    def point_markup(self):
        return self.page.locator("#svg-preview [data-role='point'], #svg-preview [aria-roledescription='point']").evaluate_all(
            "els => els.map(e => e.outerHTML)"
        )

    def wait_loaded(self):
        self.page.locator("#svg-preview svg").wait_for()
        self.page.wait_for_function("!document.querySelector('#calibrate').disabled")

    def calibrate(self, width=None, height=None):
        if width is not None:
            self.page.locator("#width-mm").fill(str(width))
        if height is not None:
            self.page.locator("#height-mm").fill(str(height))
        self.page.locator("#calibrate").click()
        self.page.wait_for_function("!document.querySelector('#export-json').disabled")

    def load_label(self):
        self.import_file(self.source("geometry/label-before.svg"), "原始毫米标签.svg")
        self.wait_loaded()
        self.calibrate()

    def select_label(self):
        self.page.locator("#objects-tab").click()
        self.page.locator(".object-button[data-object-id='标签']").click()
        self.page.wait_for_function("!document.querySelector('#apply-label').disabled")

    def download(self, selector):
        with self.page.expect_download() as pending:
            self.page.locator(selector).click()
        return Path(pending.value.path()).read_text(encoding="utf-8")

    def save_visual(self, name):
        directory = PRODUCT / ".auto-company" / "qa-screenshots"
        directory.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(directory / name), full_page=True)


class CoreFlowTests(BrowserCase):
    def test_real_tvl_requires_calibration_and_preserves_six_identities(self):
        source = self.source("tvl/named-crowded-tactile.svg")
        rejected = self.page.evaluate("""async source => {
            const e=await import('./engine.js');
            try { await e.importSvg(source,document.createElement('div'),{}); return null; }
            catch(error) { return {code:error.code,message:error.message}; }
        }""", source)
        self.assertIsNotNone(rejected, "Unitless TVL must require explicit physical dimensions")
        self.assertIn("SCALE", rejected.get("code", ""))
        state = self.engine_import(source, 200, 200 * 923 / 868.5)
        points = [o for o in state["objects"] if o["kind"] == "point"]
        self.assertEqual(len(points), 6)
        self.assertEqual(len({o["id"] for o in points}), 6)
        for number in range(1, 7):
            self.assertEqual(sum(f"id: p{number}" in o["name"] for o in points), 1)
        p2 = next(o for o in points if "id: p2" in o["name"])
        p3 = next(o for o in points if "id: p3" in o["name"])
        self.assertEqual(p2["box"], p3["box"], "Coincident records must remain coincident")
        saved = self.page.evaluate("qaEngine.serialize(qaDoc)")
        restored = self.engine_import(saved, 200, 200 * 923 / 868.5)
        after = [o for o in restored["objects"] if o["kind"] == "point"]
        self.assertEqual([(o["id"], o["name"], o["box"]) for o in points], [(o["id"], o["name"], o["box"]) for o in after])
        # defs 可随挂载安全改名，数据身份、坐标与原 path 指令必须保留。
        from xml.etree import ElementTree
        attributes = lambda obj: {key: ElementTree.fromstring(obj["markup"]).get(key) for key in ("id", "aria-label", "d", "transform")}
        self.assertEqual([attributes(o) for o in points], [attributes(o) for o in after])
        self.assertTrue(state["analysis"]["relations"], "Coincident records need a relation explanation")

    def test_real_clean_tvl_accepts_without_rebuilding_paths(self):
        source = self.source("tvl/recovered-clean-tactile.svg")
        state = self.engine_import(source, 200, 200 * 923 / 868.5)
        points = [o for o in state["objects"] if o["kind"] == "point"]
        self.assertEqual(len(points), 6)
        self.assertTrue(all("<path" in o["markup"] for o in points))
        self.assertTrue(all(o["box"][2] > o["box"][0] for o in points))
        self.assertAlmostEqual(state["widthMm"], 200)

    def test_original_geometry_has_one_millimetre_associated_gap(self):
        state = self.engine_import(self.source("geometry/label-before.svg"))
        relations = state["analysis"]["relations"]
        relation = next(r for r in relations if {r["a"], r["b"]} == {"标签", "关联点"})
        self.assertAlmostEqual(relation["gapMm"], 1.0, places=4)
        self.assertEqual(len([o for o in state["objects"] if o["kind"] == "point"]), 2)
        self.page.locator("#qa-browser-mount").evaluate("e=>e.remove()")
        self.load_label()
        self.save_visual("desktop.png")

    def test_nested_transform_geometry_matches_independent_coordinates(self):
        source = '''<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><g transform="translate(10 20)"><g transform="scale(2)"><rect id="变换对象" data-role="point" x="5" y="5" width="4" height="6"/></g></g></svg>'''
        state = self.engine_import(source)
        obj = next(o for o in state["objects"] if o["id"] == "变换对象")
        for actual, expected in zip(obj["box"], [20, 30, 28, 42]):
            self.assertAlmostEqual(actual, expected, places=4)

    def test_physical_geometry_independent_of_viewport_and_chinese_text_retained(self):
        source = '''<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><circle id="点甲" data-role="point" cx="20" cy="20" r="3"/><text id="中文标签" data-role="label" data-associated="点甲" x="30" y="20" font-size="5">中文坐标说明</text></svg>'''
        wide = self.engine_import(source)
        self.page.set_viewport_size({"width": 390, "height": 844})
        narrow = self.engine_import(source)
        for before, after in zip(wide["objects"], narrow["objects"]):
            for first, second in zip(before["box"], after["box"]):
                self.assertAlmostEqual(first, second, places=6)
        label = next(o for o in narrow["objects"] if o["id"] == "中文标签")
        self.assertIn("中文坐标说明", label["markup"])
        self.assertGreater(label["box"][2] - label["box"][0], 0)


class RecoveryTests(BrowserCase):
    def test_move_undo_reset_and_json_reload_keep_original_points(self):
        self.load_label()
        points = self.point_markup()
        before = self.page.locator("#svg-preview [id='标签']").get_attribute("transform")
        self.page.locator(".relation-item select").first.select_option("manual")
        self.page.locator(".relation-item textarea").first.fill("中文交接：需实际触读，保留重复数据点。")
        self.select_label()
        self.page.locator("#move-x").fill("2")
        self.page.locator("#move-y").fill("-8")
        self.page.locator("#apply-label").click()
        self.page.wait_for_function("!document.querySelector('#undo').disabled")
        self.assertEqual(self.point_markup(), points)
        moved = self.page.locator("#svg-preview [id='标签']").get_attribute("transform")
        self.assertNotEqual(moved, before)
        svg = self.download("#export-svg")
        state = self.engine_import(svg)
        relations = state["analysis"]["relations"]
        gaps = {r["b"] if r["a"] == "标签" else r["a"]: r["gapMm"] for r in relations if "标签" in (r["a"], r["b"])}
        # 扩大候选阈值，独立检查标签两侧的准确间距。
        if "其他点" not in gaps:
            relations = self.page.evaluate("qaEngine.analyze(qaDoc,{nearMm:6}).relations")
            gaps = {r["b"] if r["a"] == "标签" else r["a"]: r["gapMm"] for r in relations if "标签" in (r["a"], r["b"])}
        self.assertAlmostEqual(gaps["关联点"], 4.600159, places=5)
        self.assertAlmostEqual(gaps["其他点"], 4.208217, places=5)
        review = self.download("#export-json")
        review_data = json.loads(review)
        self.assertIsInstance(review_data, dict)
        self.assertTrue(any(
            d.get("note") == "中文交接：需实际触读，保留重复数据点。"
            or any(h.get("note") == "中文交接：需实际触读，保留重复数据点。" for h in d.get("history", []))
            for d in review_data["decisions"].values()
        ), "移动后的旧备注必须作为当前记录或明确的历史记录保留")
        report = self.download("#export-report")
        self.assertIn("触图审查台 · 打印前审查报告", report)
        self.assertIn("中文交接：需实际触读，保留重复数据点。", report)
        self.assertIn("需触读确认", report)
        self.assertIn("200 × 200 mm", report)
        self.page.locator("#undo").click()
        self.page.wait_for_function("document.querySelector('#svg-preview [id=\"标签\"]').getAttribute('transform') === null")
        self.assertEqual(self.point_markup(), points)
        self.page.locator("#review-file").set_input_files({"name": "saved.json", "mimeType": "application/json", "buffer": review.encode()})
        self.page.wait_for_function("document.querySelector('#svg-preview [id=\"标签\"]').getAttribute('transform') !== null")
        self.assertEqual(self.point_markup(), points)
        self.assertEqual(self.page.locator("#svg-preview [id='标签']").get_attribute("transform"), moved)
        self.assertEqual(self.page.locator("#width-mm").input_value(), "200")
        self.page.locator("#reset").click()
        self.page.wait_for_function("document.querySelector('#svg-preview [id=\"标签\"]').getAttribute('transform') === null")
        self.assertEqual(self.point_markup(), points)
        self.select_label()
        self.page.locator("#label-target").select_option("其他点")
        self.page.locator("#apply-label").click()
        self.page.wait_for_function("document.querySelector('#label-target').value === '其他点' && document.querySelector('#status').textContent.includes('已调整')")
        self.assertEqual(self.point_markup(), points)
        associated = self.download("#export-svg")
        self.assertIn('data-associated="其他点"', associated)
        self.page.locator("#undo").click()
        self.page.wait_for_function("document.querySelector('#svg-preview [id=\"标签\"]').getAttribute('data-associated') === '关联点'")

    def test_invalid_json_preserves_existing_loaded_work(self):
        self.load_label()
        before = self.page.locator("#svg-preview svg").evaluate("e=>e.outerHTML")
        valid = json.loads(self.download("#export-json"))
        malicious = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><script>window.qaXss=1</script></svg>'
        bad_inputs = ['{broken', '{"version":999,"svg":"<svg/>"}', '{"source":"<script>bad</script>"}']
        for key in ("source", "modifiedSvg"):
            bad_inputs.append(json.dumps({**valid, key: malicious}))
        bad_inputs.append(json.dumps({**valid, "print": {"widthMm": 0, "heightMm": 200}}))
        for bad in bad_inputs:
            with self.subTest(bad=bad):
                self.page.locator("#review-file").set_input_files({"name": "invalid.json", "mimeType": "application/json", "buffer": bad.encode()})
                self.page.wait_for_timeout(150)
                self.page.wait_for_function("!document.querySelector('#calibrate').disabled")
                self.assertRegex(self.page.locator("#status").inner_text(), "JSON|失败|错误|无法")
                self.assertEqual(self.page.locator("#svg-preview svg").evaluate("e=>e.outerHTML"), before)
                self.assertFalse(self.page.locator("#export-json").is_disabled())
        saved = json.loads(self.download("#export-json"))
        for key in ["source", "modifiedSvg"]:
            with self.subTest(unsafe_field=key):
                altered = dict(saved)
                altered[key] = '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><script>window.qaXss=1</script><circle r="5"/></svg>'
                self.page.locator("#review-file").set_input_files({"name": "unsafe.json", "mimeType": "application/json", "buffer": json.dumps(altered).encode()})
                self.page.wait_for_function("document.querySelector('#status').textContent.includes('恢复失败')")
                self.assertEqual(self.page.locator("#svg-preview svg").evaluate("e=>e.outerHTML"), before)
                self.assertIsNone(self.page.evaluate("window.qaXss || null"))
                self.assertIsNone(self.page.evaluate("window.qaXss || null"))

    def test_tvl_ui_blocks_analysis_until_explicit_calibration(self):
        self.import_file(self.source("tvl/named-crowded-tactile.svg"), "真实TVL.svg")
        self.page.wait_for_function("!document.querySelector('#calibrate').disabled")
        self.assertTrue(self.page.locator("#export-json").is_disabled())
        self.assertEqual(self.page.locator("#svg-preview svg").count(), 0)
        self.calibrate(200, round(200 * 923 / 868.5, 3))
        self.assertEqual(len(self.point_markup()), 6)
        self.page.locator("#objects-tab").click()
        labels = self.page.locator("#objects-list").inner_text()
        for number in range(1, 7):
            self.assertIn(f"id: p{number}", labels)
        self.assertEqual(self.remote_requests, [])

    def test_invalid_dimensions_do_not_destroy_current_preview(self):
        self.load_label()
        before = self.page.locator("#svg-preview svg").evaluate("e=>e.outerHTML")
        self.page.locator("#width-mm").fill("0")
        self.page.locator("#calibrate").click()
        self.assertFalse(self.page.locator("#width-mm").evaluate("e=>e.checkValidity()"))
        self.assertEqual(self.page.locator("#svg-preview svg").evaluate("e=>e.outerHTML"), before)
        self.page.locator("#width-mm").fill("200")
        self.calibrate()
        self.assertFalse(self.page.locator("#export-json").is_disabled())

    def test_mobile_keyboard_label_flow_has_names_and_no_page_overflow(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.load_label()
        self.page.locator("#objects-tab").focus()
        self.page.keyboard.press("Enter")
        button = self.page.locator(".object-button[data-object-id='标签']")
        button.focus()
        self.page.keyboard.press("Enter")
        self.assertFalse(self.page.locator("#move-x").is_disabled())
        self.page.locator("#move-x").fill("2")
        self.page.locator("#move-y").fill("-8")
        self.page.locator("#apply-label").focus()
        self.page.keyboard.press("Enter")
        self.page.wait_for_function("!document.querySelector('#undo').disabled")
        self.assertEqual(self.page.locator("#status").get_attribute("aria-live"), "polite")
        self.assertTrue(self.page.locator("#move-x").evaluate("e=>e.labels.length>0"))
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 392)
        self.assertIn("构造六点单元", self.download("#export-svg"))
        self.save_visual("mobile.png")


class ReviewVersionTests(BrowserCase):
    """合成100×60mm、1mm间隙的浏览器回归；不代表父原图或触读验证。"""

    NOTE = "合成版本回归：已人工确认当前间隙1毫米。"
    LABEL = "parent-label"
    POINT = "parent-point-a"

    def load_version_fixture(self):
        source = (PRODUCT / "tests/fixtures/review-version-100x60.svg").read_text(encoding="utf-8")
        self.import_file(source, "合成版本回归.svg")
        self.wait_loaded()
        self.calibrate(100, 60)
        self.wait_idle()
        self.assertEqual(self.page.locator(".relation-item").count(), 1)
        self.assertIn("1 mm", self.relation().inner_text())

    def wait_idle(self):
        self.page.wait_for_function("!document.querySelector('#export-json').disabled")

    def relation(self, point=None):
        return self.page.locator(".relation-item").filter(has_text=point or self.POINT)

    def confirm(self, status="accepted", note=None):
        self.page.locator("#relations-tab").click()
        self.relation().locator("select").select_option(status)
        self.relation().locator("textarea").fill(note or self.NOTE)
        self.assertEqual(self.relation().locator("select").input_value(), status)
        self.assertRegex(self.page.locator("#review-progress").inner_text(), r"^1\s*/\s*1")

    def change_label(self, dx=None, target=None):
        self.page.locator("#objects-tab").click()
        self.page.locator(f".object-button[data-object-id='{self.LABEL}']").click()
        if dx is not None:
            self.page.locator("#move-x").fill(str(dx))
        if target is not None:
            self.page.locator("#label-target").select_option(target)
        self.page.locator("#apply-label").click()
        self.wait_idle()
        self.page.locator("#relations-tab").click()

    def saved(self):
        return json.loads(self.download("#export-json"))

    def decision(self, data, point=None):
        identities = {self.LABEL, point or self.POINT}
        return next(d for key, d in data["decisions"].items() if set(json.loads(key)) == identities)

    def gap(self, data, point=None):
        identities = {self.LABEL, point or self.POINT}
        return next(r["gapMm"] for r in data["relations"] if {r["a"], r["b"]} == identities)

    def assert_pending_history(self, note=None, point=None):
        item = self.relation(point)
        self.assertEqual(item.locator("select").input_value(), "pending")
        self.assertEqual(item.locator("textarea").input_value(), "")
        self.assertIn("待重新审查", item.inner_text())
        history = item.locator(".decision-history")
        if not history.evaluate("e => e.open"):
            history.locator("summary").click()
        self.assertIn(note or self.NOTE, history.inner_text())
        self.assertRegex(self.page.locator("#review-progress").inner_text(), r"^0\s*/")
        decision = self.decision(self.saved(), point)
        self.assertEqual(decision["status"], "pending")
        self.assertEqual(decision["note"], "")
        self.assertTrue(any(h.get("note") == (note or self.NOTE) for h in decision.get("history", [])))

    def restore(self, data):
        self.page.locator("#review-file").set_input_files({
            "name": "版本回归恢复.json", "mimeType": "application/json", "buffer": json.dumps(data, ensure_ascii=False).encode()
        })
        self.page.wait_for_function("document.querySelector('#status').textContent.includes('已恢复')")
        self.wait_idle()
        self.page.locator("#relations-tab").click()

    def test_label_move_invalidates_current_report_and_undo_restores_matching_judgment(self):
        self.load_version_fixture()
        self.confirm()
        points = self.point_markup()
        self.assertAlmostEqual(self.gap(self.saved()), 1)
        self.change_label(dx=-2)
        self.assertEqual(self.point_markup(), points)
        self.assert_pending_history()
        self.assertAlmostEqual(self.gap(self.saved()), 0)
        report = self.download("#export-report")
        self.assertIn("状态：待审查", report)
        self.assertIn(self.NOTE, report)
        self.assertIn("历史", report)
        self.assertIn("0 mm", report)
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertEqual(self.relation().locator("textarea").input_value(), self.NOTE)
        self.assertAlmostEqual(self.gap(self.saved()), 1)
        self.assertEqual(self.point_markup(), points)

    def test_exact_parent_synthetic_input_new_judgment_becomes_history_after_undo(self):
        source = (PRODUCT / "tests/fixtures/tactile-parent.svg").read_text(encoding="utf-8")
        self.import_file(source, "父验收原合成输入.svg")
        self.wait_loaded()
        self.calibrate(100, 60)
        self.wait_idle()
        self.confirm()
        points = self.point_markup()
        self.assertAlmostEqual(self.gap(self.saved()), 1)
        self.change_label(dx=-2)
        self.assert_pending_history()
        self.assertAlmostEqual(self.gap(self.saved()), 0)
        modified_note = "父验收原合成输入：重新确认修改后间隙0毫米。"
        self.confirm(note=modified_note)
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assertEqual(self.point_markup(), points)
        self.assertAlmostEqual(self.gap(self.saved()), 1)
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertEqual(self.relation().locator("textarea").input_value(), self.NOTE)
        restored = self.decision(self.saved())
        self.assertTrue(any(h.get("note") == modified_note for h in restored["history"]))
        report = self.download("#export-report")
        current_section = report.split("历史审查", 1)[0]
        self.assertIn(self.NOTE, current_section)
        self.assertNotIn(modified_note, current_section)
        self.assertIn(modified_note, report)

    def test_unrelated_confirmed_point_pair_remains_valid_when_label_elsewhere_moves(self):
        source = (PRODUCT / "tests/fixtures/review-unrelated-100x60.svg").read_text(encoding="utf-8")
        self.import_file(source, "合成无关关系.svg")
        self.wait_loaded()
        self.calibrate(100, 60)
        self.wait_idle()
        self.assertEqual(self.page.locator(".relation-item").count(), 2)
        self.relation().locator("select").select_option("accepted")
        self.relation().locator("textarea").fill(self.NOTE)
        independent = self.page.locator(".relation-item").filter(has_text="independent-point-a")
        independent.locator("select").select_option("accepted")
        independent_note = "独立点对：确认当前1毫米，不涉及标签。"
        independent.locator("textarea").fill(independent_note)
        identities = {"independent-point-a", "independent-point-b"}
        before = self.saved()
        previous = next(d for key, d in before["decisions"].items() if set(json.loads(key)) == identities)
        points = self.point_markup()
        self.change_label(dx=-2)
        self.assertEqual(self.point_markup(), points)
        self.assertEqual(self.relation().locator("select").input_value(), "pending")
        self.assertEqual(independent.locator("select").input_value(), "accepted")
        self.assertEqual(independent.locator("textarea").input_value(), independent_note)
        self.assertRegex(self.page.locator("#review-progress").inner_text(), r"^1\s*/\s*2")
        after = self.saved()
        unchanged = next(d for key, d in after["decisions"].items() if set(json.loads(key)) == identities)
        self.assertEqual(unchanged, previous)
        self.restore(after)
        self.assertEqual(independent.locator("select").input_value(), "accepted")
        self.assertEqual(independent.locator("textarea").input_value(), independent_note)
        self.assertEqual(self.relation().locator("select").input_value(), "pending")
        self.assertRegex(self.page.locator("#review-progress").inner_text(), r"^1\s*/\s*2")

    def test_print_recalibration_invalidates_and_undo_restores_dimensions_and_judgment(self):
        self.load_version_fixture()
        self.confirm()
        self.calibrate(200, 120)
        self.wait_idle()
        self.assert_pending_history()
        self.assertAlmostEqual(self.gap(self.saved()), 2)
        self.assertIn("200 × 120 mm", self.download("#export-report"))
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assertEqual(self.page.locator("#width-mm").input_value(), "100")
        self.assertEqual(self.page.locator("#height-mm").input_value(), "60")
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertAlmostEqual(self.gap(self.saved()), 1)

    def test_association_change_invalidates_old_judgment_without_moving_points(self):
        self.load_version_fixture()
        self.confirm()
        points = self.point_markup()
        self.change_label(target="parent-point-b")
        self.assertEqual(self.point_markup(), points)
        self.assert_pending_history()
        self.assertEqual(self.relation("parent-point-b").locator("select").input_value(), "pending")
        self.assertIn('data-associated="parent-point-b"', self.download("#export-svg"))
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertIn('data-associated="parent-point-a"', self.download("#export-svg"))

    def test_threshold_change_and_return_require_review_but_undo_restores_actual_policy(self):
        self.load_version_fixture()
        self.confirm()
        self.page.locator("#near-mm").fill("0.5")
        self.page.locator("#reanalyze").click()
        self.wait_idle()
        self.assert_pending_history()
        data = self.saved()
        self.assertEqual(data["nearMm"], 0.5)
        self.assertFalse(data["relations"][0]["candidate"])
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assertEqual(self.page.locator("#near-mm").input_value(), "3")
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        for value in (0.5, 3):
            self.page.locator("#near-mm").fill(str(value))
            self.page.locator("#reanalyze").click()
            self.wait_idle()
        self.assert_pending_history()

    def test_valid_and_stale_json_roundtrips_keep_current_and_historical_conclusions_separate(self):
        self.load_version_fixture()
        self.confirm()
        approved = self.saved()
        self.assertEqual(approved["version"], 2)
        self.assertTrue(self.decision(approved).get("basis"))
        self.change_label(dx=-2)
        stale = self.saved()
        self.restore(approved)
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertEqual(self.relation().locator("textarea").input_value(), self.NOTE)
        self.assertAlmostEqual(self.gap(self.saved()), 1)
        self.restore(stale)
        self.assert_pending_history()
        after = self.saved()
        self.assertAlmostEqual(self.gap(after), 0)
        self.assertEqual(self.decision(after).get("history"), self.decision(stale).get("history"))
        report = self.download("#export-report")
        self.assertIn("状态：待审查", report)
        self.assertIn(self.NOTE, report)
        self.assertIn("历史", report)

    def test_relation_leaving_and_returning_to_threshold_keeps_only_historical_confirmation(self):
        self.load_version_fixture()
        self.change_label(target="")
        note = "合成未关联关系：确认当前1毫米近距。"
        self.confirm(note=note)
        self.page.locator("#near-mm").fill("0.5")
        self.page.locator("#reanalyze").click()
        self.wait_idle()
        self.assertEqual(self.page.locator(".relation-item").count(), 0)
        hidden = self.decision(self.saved())
        self.assertEqual(hidden["status"], "pending")
        self.assertTrue(any(h.get("note") == note for h in hidden.get("history", [])))
        report = self.download("#export-report")
        self.assertIn(note, report)
        self.assertIn("历史", report)
        self.page.locator("#near-mm").fill("3")
        self.page.locator("#reanalyze").click()
        self.wait_idle()
        self.assert_pending_history(note=note)

    def test_changed_json_geometry_size_association_and_policy_cannot_reuse_old_basis(self):
        self.load_version_fixture()
        self.confirm()
        original = self.saved()
        for change in ("geometry", "print", "association", "policy"):
            with self.subTest(change=change):
                altered = json.loads(json.dumps(original))
                if change == "geometry":
                    altered["modifiedSvg"] = altered["modifiedSvg"].replace('id="parent-label"', 'id="parent-label" transform="translate(-2 0)"')
                    self.assertNotEqual(altered["modifiedSvg"], original["modifiedSvg"])
                elif change == "print":
                    altered["print"] = {"widthMm": 200, "heightMm": 120}
                elif change == "association":
                    altered["modifiedSvg"] = altered["modifiedSvg"].replace('data-associated="parent-point-a"', 'data-associated="parent-point-b"').replace('data-association="parent-point-a"', 'data-association="parent-point-b"')
                    self.assertNotEqual(altered["modifiedSvg"], original["modifiedSvg"])
                else:
                    altered["nearMm"] = 0.5
                # 顶层relations是导出摘要；恢复必须根据实际SVG/尺寸/策略重算。
                altered["relations"] = [{**r, "gapMm": 999} for r in altered["relations"]]
                self.restore(altered)
                self.assert_pending_history()
                actual = self.saved()
                expected = {"geometry": 0, "print": 2, "association": 1, "policy": 1}[change]
                self.assertAlmostEqual(self.gap(actual), expected)

    def test_legacy_unversioned_judgment_is_retained_as_history_and_explicit_reconfirmation_is_current(self):
        self.load_version_fixture()
        self.confirm()
        legacy = self.saved()
        legacy["version"] = 1
        for decision in legacy["decisions"].values():
            decision.pop("basis", None)
            decision.pop("history", None)
        self.restore(legacy)
        self.assert_pending_history()
        fresh_note = "已重新确认当前1毫米；旧结论仅留历史。"
        self.confirm(note=fresh_note)
        current = self.saved()
        decision = self.decision(current)
        self.assertEqual(decision["status"], "accepted")
        self.assertEqual(decision["note"], fresh_note)
        self.assertTrue(any(h.get("note") == self.NOTE for h in decision["history"]))
        self.restore(current)
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertEqual(self.relation().locator("textarea").input_value(), fresh_note)

    def test_noop_does_not_expire_judgment_and_reset_undo_keeps_versioned_history(self):
        self.load_version_fixture()
        self.confirm()
        before = self.saved()
        self.change_label(dx=0, target=self.POINT)
        self.calibrate(100, 60)
        self.page.locator("#reanalyze").click()
        self.wait_idle()
        self.assertEqual(self.relation().locator("select").input_value(), "accepted")
        self.assertEqual(self.decision(self.saved()).get("basis"), self.decision(before).get("basis"))
        self.change_label(dx=-2)
        stale = self.saved()
        self.page.locator("#reset").click()
        self.wait_idle()
        self.page.locator("#undo").click()
        self.wait_idle()
        self.assert_pending_history()
        self.assertAlmostEqual(self.gap(self.saved()), 0)
        self.assertEqual(self.decision(self.saved()).get("history"), self.decision(stale).get("history"))

    def test_dense_unreviewed_geometry_exports_no_decisions_and_restores_all_relations(self):
        self.page.set_default_timeout(60000)
        circles = "".join(
            f'<circle id="dense-point-{number}" data-role="point" cx="20" cy="30" r="2"/>'
            for number in range(150)
        )
        source = f'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">{circles}</svg>'
        self.import_file(source, "合成150同位点.svg")
        self.wait_loaded()
        self.calibrate(100, 60)
        self.wait_idle()
        self.assertEqual(len(self.point_markup()), 150)
        data = self.saved()
        self.assertEqual(data["decisions"], {}, "未人工操作不应自动生成11175条待审查记录")
        self.assertEqual(len(data["relations"]), 150 * 149 // 2)
        self.assertTrue(all(r["type"] == "coincident" and r["gapMm"] == 0 for r in data["relations"]))
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.page.locator("#svg-preview svg").count(), 0)
        self.restore(data)
        restored = self.saved()
        self.assertEqual(len(self.point_markup()), 150)
        self.assertEqual(restored["decisions"], {})
        self.assertEqual(len(restored["relations"]), 11175)
        self.assertEqual(restored["relations"], data["relations"])
        self.assertRegex(self.page.locator("#review-progress").inner_text(), r"^0\s*/\s*11175")


class SafeInputTests(BrowserCase):
    def test_source_identifiers_and_classes_do_not_override_interface_or_geometry(self):
        source = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle id="status" class="preview-overlay" data-role="point" cx="20" cy="20" r="3"/><text id="relations-list" class="empty-symbol" data-role="label" data-associated="status" x="25" y="20" font-size="5">标签甲</text></svg>'
        self.import_file(source)
        self.wait_loaded()
        self.calibrate()
        label = self.page.locator("#svg-preview text")
        self.assertEqual(label.evaluate("e=>getComputedStyle(e).fontSize"), "5px")
        self.page.locator("#objects-tab").click()
        self.page.locator(".object-button[data-object-id='relations-list']").click()
        self.assertEqual(self.page.locator("#svg-preview circle[id='status']").count(), 1)
        self.assertEqual(self.page.locator("#svg-preview text[id='relations-list']").text_content(), "标签甲")
        self.assertIn("打印尺寸已确认", self.page.locator(".drawing-panel > .status").inner_text())
        saved = self.download("#export-svg")
        self.assertIn('id="status"', saved)
        self.assertIn('id="relations-list"', saved)
        self.assertIn('font-size="5"', saved)
        self.assertEqual(self.remote_requests, [])

    def assert_rejected(self, source):
        result = self.page.evaluate("""async source => {
            const e = await import('./engine.js');
            const mount=document.createElement('div'); document.body.append(mount);
            try { await e.importSvg(source,mount,{}); return {accepted:true}; }
            catch(error) { return {accepted:false,message:error.message,children:mount.children.length}; }
        }""", source)
        self.assertFalse(result["accepted"], source[:160])
        self.assertEqual(result["children"], 0, "Unsafe content must not reach live SVG DOM")
        self.assertIsNone(self.page.evaluate("window.qaXss || null"))
        self.assertEqual(self.remote_requests, [])

    def test_script_and_event_handlers_rejected(self):
        for body in ['<script>window.qaXss=1</script>', '<rect width="10" height="10" onload="window.qaXss=1"/>']:
            with self.subTest(body=body):
                self.assert_rejected(f'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">{body}</svg>')

    def test_remote_links_and_external_css_rejected_before_render(self):
        for body in ['<image href="https://example.invalid/tracker.svg"/>', '<style>@import url(https://example.invalid/tracker.css);</style>', '<rect width="10" height="10" fill="url(https://example.invalid/x.svg#p)"/>']:
            with self.subTest(body=body):
                self.assert_rejected(f'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">{body}</svg>')

    def test_foreign_object_and_doctype_rejected(self):
        sources = ['<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">active html</div></foreignObject></svg>', '<!DOCTYPE svg [<!ENTITY x "external entity">]><svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><text>&x;</text></svg>']
        for body in ['<rect id="重复" width="10" height="10"/><circle id="重复" cx="20" cy="20" r="2"/>', '<rect width="10" height="10" clip-path="url(#clip)"/>', '<rect width="10" height="10" mask="url(#mask)"/>']:
            sources.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">{body}</svg>')
        for source in sources:
            with self.subTest(source=source[:80]):
                self.assert_rejected(source)

    def test_malformed_xml_and_invalid_viewbox_rejected(self):
        for source in ['<svg><g></svg>', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 0 100"/>', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 NaN 100"/>']:
            with self.subTest(source=source):
                self.assert_rejected(source)

    def test_zero_negative_and_nonfinite_calibration_rejected(self):
        source = self.source("tvl/named-crowded-tactile.svg")
        for width, height in [(0, 200), (-10, 200), (200, 0), ("NaN", 200), ("Infinity", 200)]:
            with self.subTest(width=width, height=height):
                result = self.page.evaluate("""async input => {
                    const e=await import('./engine.js'); const mount=document.createElement('div'); document.body.append(mount);
                    try {await e.importSvg(input.source,mount,{widthMm:input.width,heightMm:input.height}); return null;}
                    catch(error){return {message:error.message,code:error.code};}
                }""", {"source": source, "width": width, "height": height})
                self.assertIsNotNone(result, "Invalid physical calibration must be rejected")
                self.assertNotEqual(result["code"], "MEASUREMENT_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
