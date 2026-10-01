"""本地披露文件双向检查；结果是复核依据，不是安全认证。"""
import base64
import binascii
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import pymupdf as fitz

MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_BATCH_BYTES = 25 * 1024 * 1024
MAX_FILE_PAGES = 200
MAX_BATCH_PAGES = 500
MAX_OBJECT_BYTES = 32 * 1024 * 1024
MAX_FINDINGS = 400


class ValidationError(ValueError):
    """用户可以修复的批次输入错误。"""


class FileInputError(ValueError):
    """可公开给用户的稳定文件输入提示。"""


def normalize(text):
    """统一全半角、大小写和 PDF 抽取产生的字间空白。"""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()


def _label(value, name, limit=180):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValidationError(f"{name}必须是非空文本，且不超过 {limit} 个字符。")
    if any(ord(character) < 32 for character in value):
        raise ValidationError(f"{name}不能包含控制字符。")
    return value.strip()


def validate_payload(payload):
    if not isinstance(payload, dict):
        raise ValidationError("请求必须是 JSON 对象。")
    batch_name = _label(payload.get("batch_name"), "批次名称")
    raw_rules = payload.get("rules")
    if not isinstance(raw_rules, dict):
        raise ValidationError("请提供规则对象。")
    rules = {key: _label(raw_rules.get(key), label) for key, label in
             [("version", "规则版本"), ("approved_by", "规则批准人")]}
    for kind, label in [("remove", "应删除规则"), ("retain", "应保留规则")]:
        values = raw_rules.get(kind)
        if not isinstance(values, list) or not 1 <= len(values) <= 100:
            raise ValidationError(f"{label}必须包含 1 至 100 条文本。")
        rules[kind] = [_label(value, label, 300) for value in values]
        normalized = [normalize(value) for value in rules[kind]]
        if len(set(normalized)) != len(normalized):
            raise ValidationError(f"{label}存在规范化后重复的规则。")
    remove = [normalize(value) for value in rules["remove"]]
    retain = [normalize(value) for value in rules["retain"]]
    if any(left in right or right in left for left in remove for right in retain):
        raise ValidationError("删除与保留规则存在相同或相互包含的冲突，请先修订规则。")
    files = payload.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValidationError(f"每批必须包含 1 至 {MAX_FILES} 个 PDF。")
    names = []
    estimated_bytes = 0
    for file in files:
        if not isinstance(file, dict):
            raise ValidationError("文件条目必须是对象。")
        name = _label(file.get("name"), "文件名")
        if "/" in name or "\\" in name or name in (".", ".."):
            raise ValidationError("文件名不能包含路径。")
        if name.casefold() in names:
            raise ValidationError("同一批次的文件名不能重复。")
        names.append(name.casefold())
        data = file.get("data")
        if isinstance(data, str):
            estimated_bytes += len(data) * 3 // 4
    # base64 末尾填充最多造成每份 2 字节的估算差异。
    if estimated_bytes > MAX_BATCH_BYTES + 2 * MAX_FILES:
        raise ValidationError("本批文件总大小超过 25 MB，请拆分批次。")
    return batch_name, rules, files


def _pdf_strings(data):
    """补充可读原对象字符串；复杂编码和历史修订仍须独立人工检查。"""
    texts = []
    for token in re.findall(rb"\((?:\\.|[^\\)]){1,8192}\)|<([0-9A-Fa-f\s]{2,16384})>", data):
        # findall 的捕获组仅返回 hex；literal 由下方独立扫描。
        if token:
            try:
                raw = bytes.fromhex(token.decode("ascii"))
                texts.extend(_decode_text(raw))
            except (ValueError, UnicodeError):
                pass
    for token in re.finditer(rb"\((?:\\.|[^\\)]){1,8192}\)", data):
        raw = token.group()[1:-1]
        raw = re.sub(rb"\\([0-7]{1,3})", lambda match: bytes([int(match[1], 8) % 256]), raw)
        raw = re.sub(rb"\\([()\\])", rb"\1", raw)
        texts.extend(_decode_text(raw))
    texts.extend(_decode_text(data))
    return "\n".join(texts)


def _decode_text(data):
    results = []
    for encoding in ("utf-8", "utf-16-be", "utf-16-le", "latin-1"):
        try:
            results.append(data.decode(encoding))
        except UnicodeError:
            pass
    return results


def check_file(name, data, rules, remaining_pages=MAX_BATCH_PAGES):
    result = {"name": name.strip(), "sha256": None, "pages": 0, "status": "error",
              "findings": [], "coverage": [], "error": None}
    try:
        if not isinstance(data, str):
            raise FileInputError("文件内容必须是 base64 文本。")
        if len(data) > ((MAX_FILE_BYTES + 2) // 3) * 4:
            raise FileInputError("单文件超过 10 MB，请拆分文件。")
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            raise FileInputError("文件 base64 编码无效，请重新选择 PDF。") from None
        if not raw or len(raw) > MAX_FILE_BYTES:
            raise FileInputError("文件为空或超过 10 MB。")
        result["sha256"] = hashlib.sha256(raw).hexdigest()
        if not raw[:1024].lstrip().startswith(b"%PDF-"):
            raise FileInputError("文件内容不是 PDF。")
        with fitz.open(stream=raw, filetype="pdf") as document:
            if document.needs_pass:
                raise FileInputError("PDF 已加密，请在本地解密后重新检查。")
            count = document.page_count
            if not 1 <= count <= MAX_FILE_PAGES:
                raise FileInputError("PDF 页数必须为 1 至 200 页。")
            if count > remaining_pages:
                raise FileInputError("本批总页数超过 500 页，请另建批次。")
            result["pages"] = count
            _inspect(document, raw, rules, result)
        result["status"] = "issues" if any(f["severity"] == "error" for f in result["findings"]) else "review"
    except Exception as error:
        # 解析器细节可能包含文件中的敏感文字，只公开稳定的用户提示。
        result["error"] = str(error) if isinstance(error, FileInputError) else "PDF 无法完整解析，请修复或替换该文件后重试。"
        result["findings"] = []
        result["coverage"] = []
    return result


def _inspect(document, raw, rules, result):
    normalized_remove = [normalize(value) for value in rules["remove"]]
    normalized_retain = [normalize(value) for value in rules["retain"]]
    seen = set()
    found_retain = set()
    has_text = False
    image_pages = []
    object_complete = True
    budget = MAX_OBJECT_BYTES
    truncated = False

    def finding(kind, severity, rule_index, page, location, message):
        nonlocal truncated
        key = (kind, rule_index, page, location)
        if key in seen:
            return
        if len(result["findings"]) >= MAX_FINDINGS:
            truncated = True
            return
        seen.add(key)
        result["findings"].append({"id": f"f{len(result['findings']) + 1}", "kind": kind,
            "severity": severity, "rule_index": rule_index, "page": page,
            "location": location, "message": message})

    def scan(text, location, page=None):
        normalized = normalize(text)
        for index, rule in enumerate(normalized_remove):
            if rule in normalized:
                finding("remove", "error", index, page, location,
                        f"发现应删除规则 {index + 1} 的匹配内容。")

    for index, page in enumerate(document):
        text = page.get_text("text", sort=True)
        normalized = normalize(text)
        has_text = has_text or bool(normalized)
        scan(text, "页面文本", index + 1)
        for rule_index, rule in enumerate(normalized_retain):
            if rule in normalized:
                found_retain.add(rule_index)
        if page.get_images(full=True):
            image_pages.append(index + 1)
        annotations = page.annots()
        if annotations:
            for annotation in annotations:
                scan(json.dumps(annotation.info, ensure_ascii=False), "批注", index + 1)
                if annotation.type[0] == fitz.PDF_ANNOT_REDACT:
                    finding("coverage", "error", None, index + 1, "未应用的脱敏批注",
                            "存在尚未应用的脱敏批注；请在本地实际应用脱敏并另存最终文件后重查。")
    scan(json.dumps(document.metadata or {}, ensure_ascii=False), "元数据")
    for attachment in document.embfile_names():
        scan(attachment, "附件名称")
        info = document.embfile_info(attachment)
        scan(json.dumps(info, ensure_ascii=False), "附件信息")
        if info.get("size", 0) > 4 * 1024 * 1024:
            object_complete = False
            continue
        content = document.embfile_get(attachment)
        if len(content) > budget:
            object_complete = False
            continue
        budget -= len(content)
        scan("\n".join(_decode_text(content)), "附件可读文本")
    if document.xref_length() > 20000:
        object_complete = False
    for xref in range(1, min(document.xref_length(), 20000)):
        object_text = document.xref_object(xref, compressed=False)
        scan(object_text, "原对象")
        scan(_pdf_strings(object_text.encode("utf-8")), "原对象")
        if document.xref_is_stream(xref):
            # 图像 / 字体不解压，避免把压缩炸弹作为文本加载。
            if "/Subtype /Image" in object_text or "/Length1" in object_text:
                continue
            compressed = document.xref_stream_raw(xref)
            if len(compressed) > 4 * 1024 * 1024 or budget <= 0:
                object_complete = False
                continue
            # 所有解压都在隔离子进程中受内存和时限约束（HTTP 入口）。
            stream = document.xref_stream(xref)
            if len(stream) > min(4 * 1024 * 1024, budget):
                object_complete = False
                continue
            budget -= len(stream)
            scan(_pdf_strings(stream), "对象流可读文本")
    # 直接搜索现存文件字节补充未压缩历史内容，不能穷尽旧修订。
    scan("\n".join(_decode_text(raw)), "原文件可读字节")
    for index in range(len(normalized_retain)):
        if index not in found_retain:
            uncertain = not has_text or bool(image_pages)
            finding("retain", "warning" if uncertain else "error", index, None, "页面文本",
                    f"未在页面可检文本中找到保留规则 {index + 1}；" +
                    ("图像或扫描内容须人工核对，不能据此确定已过删。" if uncertain else "请核对是否过度删除或文字抽取异常。"))
    result["coverage"] = [
        {"id": "page-text", "status": "checked", "message": "已检查逐页可抽取文本（含可抽取隐藏文字）；保留规则仅在页面检索。"},
        {"id": "metadata-annotations", "status": "checked", "message": "已检查元数据、批注及附件可读内容。"},
        {"id": "object-text", "status": "checked" if object_complete else "manual", "message": "已补充原对象和可读对象流检索；复杂编码、未检查对象及嵌套附件仍须人工复核。"},
        {"id": "visual-ocr", "status": "manual", "message": "未运行 OCR、视觉遮盖判断和扫描内容检查；" + (f"发现 {len(image_pages)} 页包含图像。" if image_pages else "仍须逐页视觉复核。")},
        {"id": "old-revisions", "status": "manual", "message": "未穷尽增量保存旧修订、所有对象编码及文件恢复路径，须用独立工具复核。"},
        {"id": "human-approval", "status": "manual", "message": "规则批准人字段是本地填写记录；须人工确认规则充分性、最终文件和披露批准。"},
    ]
    for item in result["coverage"]:
        if item["status"] == "manual":
            finding("coverage", "warning", None, None, item["id"], item["message"])
    if truncated:
        raise FileInputError("发现项超过单文件 400 条限制，检查未完成；请拆分文件并缩小规则集后重新检查。")


def _isolated_file(name, data, rules, remaining_pages):
    request = {"name": name, "data": data, "rules": rules, "remaining_pages": remaining_pages}
    try:
        execution = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--check-file"],
            input=json.dumps(request, ensure_ascii=False).encode(), capture_output=True, timeout=20,
            env={**os.environ, "PYMUPDF_MESSAGE": "fd:2", "PYMUPDF_LOG": "fd:2"})
        if execution.returncode == 0:
            return json.loads(execution.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        pass
    digest = None
    try:
        digest = hashlib.sha256(base64.b64decode(data, validate=True)).hexdigest()
    except (TypeError, ValueError, binascii.Error):
        pass
    return {"name": name, "sha256": digest, "pages": 0, "status": "error", "findings": [],
            "coverage": [], "error": "文件解析超过本地资源或时间限制，请拆分文件后重试；本批其他文件仍可检查。"}


def check_batch(payload, isolate=False):
    batch_name, rules, files = validate_payload(payload)
    results = []
    pages = 0
    actual_bytes = 0
    for file in files:
        data = file.get("data")
        if isinstance(data, str):
            try:
                actual_bytes += len(base64.b64decode(data, validate=True))
            except (binascii.Error, ValueError):
                pass
        if actual_bytes > MAX_BATCH_BYTES:
            raise ValidationError("本批文件总大小超过 25 MB，请拆分批次。")
        checker = _isolated_file if isolate else check_file
        result = checker(file["name"], data, rules, MAX_BATCH_PAGES - pages)
        pages += result["pages"]
        results.append(result)
    summary = {"total": len(results), **{status: sum(file["status"] == status for file in results)
               for status in ("issues", "review", "checked", "error")},
               "findings": sum(len(file["findings"]) for file in results)}
    serialized_rules = json.dumps(rules, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {"schema_version": "1.0", "batch_name": batch_name,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "rules": rules, "rule_hash": hashlib.sha256(serialized_rules.encode()).hexdigest(),
            "files": results, "summary": summary}


def demo_payload():
    files = []
    public = "公开金额100万元"
    secret = "保密代号青竹"
    for name, text, raster in [
        ("01-正确脱敏.pdf", public + "，项目进度正常。", False),
        ("02-仍有泄漏.pdf", public + "，" + secret, False),
        ("03-过度删除.pdf", "报告内容已删除，仅剩标题。", False),
        ("04-扫描待复核.pdf", public + "，项目进度正常。", True),
    ]:
        with fitz.open() as document:
            page = document.new_page(width=595, height=842)
            page.insert_text((60, 100), text, fontname="china-s", fontsize=15)
            if raster:
                image = page.get_pixmap(matrix=fitz.Matrix(1, 1)).tobytes("png")
                document.delete_page(0)
                page = document.new_page(width=595, height=842)
                page.insert_image(page.rect, stream=image)
            raw = document.tobytes(garbage=4, deflate=True)
        files.append({"name": name, "data": base64.b64encode(raw).decode("ascii")})
    return {"batch_name": "合成演示批次（非真实客户文件）", "rules": {
            "version": "演示规则-v1", "approved_by": "合成演示批准人", "remove": [secret], "retain": [public]},
            "files": files}


if __name__ == "__main__" and sys.argv[1:] == ["--check-file"]:
    # 仅服务端调用；每个文件单独限制资源，解析异常不连累整批。
    import resource

    # 子进程 stdout 仅用于 JSON 协议，库诊断保留在捕获的 stderr。
    fitz.set_messages(stream=sys.stderr)
    fitz.set_log(stream=sys.stderr)
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    request = json.load(sys.stdin)
    result = check_file(request["name"], request["data"], request["rules"], request["remaining_pages"])
    print(json.dumps(result, ensure_ascii=False))
