"""机会实验：生成无真实隐私的 PDF，并原样执行公开替代。不是生产检查器。"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

import pymupdf as pdf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/evaluation/experiment"
INPUTS = OUT / "inputs"
SECRET = "SYNTH-SECRET-472819"
PUBLIC = "PUBLIC-DECISION-8462"
REGION = pdf.Rect(65, 95, 310, 120)


def base(secret=False):
    doc = pdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 55), "构造披露材料：不含真实个人信息", fontname="china-s", fontsize=16)
    if secret:
        page.insert_text((72, 112), SECRET, fontsize=12)
    page.insert_text((72, 170), PUBLIC, fontsize=12)
    page.insert_text((72, 200), "应保留结论：本批次批准公开的事项。", fontname="china-s", fontsize=12)
    return doc


def save(doc, name):
    path = INPUTS / f"{name}.pdf"
    doc.save(path, garbage=4, clean=True, deflate=True)
    doc.close()
    return path


def redact(doc):
    doc[0].add_redact_annot(REGION, fill=(0, 0, 0))
    doc[0].apply_redactions()
    doc.scrub()


def fixtures():
    INPUTS.mkdir(parents=True, exist_ok=True)
    manifest = []

    def record(name, truth, path, recoverable, public_searchable=True):
        manifest.append({"id": name, "truth": truth, "path": str(path.relative_to(ROOT)),
                         "recoverable_secret": recoverable,
                         "public_searchable_expected": public_searchable,
                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})

    doc = base(True)
    doc[0].draw_rect(REGION, fill=(0, 0, 0), color=(0, 0, 0), overlay=True)
    record("01-cover", "黑框盖住可提取秘密文字", save(doc, "01-cover"), True)

    doc = base(True)
    redact(doc)
    record("02-clean", "正确脱敏并完整重写，保留公开信息", save(doc, "02-clean"), False)

    doc = base()
    doc.set_metadata({"author": SECRET})
    record("03-metadata", "页面干净，作者元数据含秘密", save(doc, "03-metadata"), True)

    doc = base()
    doc.embfile_add("private.txt", SECRET.encode(), filename="private.txt")
    record("04-attachment", "页面干净，附件含秘密", save(doc, "04-attachment"), True)

    doc = base(True)
    doc[0].add_redact_annot(REGION, fill=(0, 0, 0))
    record("05-unapplied", "脱敏标记未应用，原文仍在", save(doc, "05-unapplied"), True)

    path = save(base(True), "06-incremental")
    with pdf.open(path) as doc:
        redact(doc)
        doc.saveIncr()
    record("06-incremental", "当前页面已删秘密，但历史版本仍存原文", path, True)

    doc = base()
    doc[0].draw_rect(pdf.Rect(72, 235, 260, 255), fill=(0, 0, 0), color=(0, 0, 0))
    record("07-design", "正常黑色装饰块，无秘密", save(doc, "07-design"), False)

    source = base(True)
    image = source[0].get_pixmap(matrix=pdf.Matrix(2, 2)).tobytes("png")
    source.close()
    doc = pdf.open()
    doc.new_page(width=595, height=842).insert_image(pdf.Rect(0, 0, 595, 842), stream=image)
    doc[0].draw_rect(REGION, fill=(0, 0, 0), color=(0, 0, 0), overlay=True)
    record("08-image-cover", "图像秘密被盖住，底层图像可提取", save(doc, "08-image-cover"), True, False)

    doc = base()
    path = INPUTS / "09-encrypted.pdf"
    doc.save(path, encryption=pdf.PDF_ENCRYPT_AES_256, owner_pw="SYNTHETIC-OWNER",
             user_pw="SYNTHETIC-READER")
    doc.close()
    record("09-encrypted", "加密输入，无密码时不能判断", path, False)

    source = base()
    image = source[0].get_pixmap(matrix=pdf.Matrix(2, 2)).tobytes("png")
    source.close()
    doc = pdf.open()
    doc.new_page(width=595, height=842).insert_image(pdf.Rect(0, 0, 595, 842), stream=image)
    record("10-raster-clean", "可见干净扫描件，无可检索文字", save(doc, "10-raster-clean"), False, False)

    (OUT / "fixture-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def run(cmd, label, env):
    start = time.perf_counter()
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
    (OUT / f"{label}.stdout.txt").write_text(result.stdout)
    (OUT / f"{label}.stderr.txt").write_text(result.stderr)
    return {"command": cmd, "returncode": result.returncode,
            "seconds": round(time.perf_counter() - start, 4),
            "stdout": f"{label}.stdout.txt", "stderr": f"{label}.stderr.txt"}


def main():
    started = time.perf_counter()
    manifest = fixtures()
    rules = OUT / "secrets.json"
    rules.write_text(json.dumps([{"name": "构造秘密标记", "value": SECRET}], ensure_ascii=False))
    env = os.environ.copy()
    prefix = Path("/tmp/b-confirm-open-1-baseline/system")
    env["PATH"] = f"/tmp/b-confirm-open-1-baseline/bin:{prefix}/usr/bin:{Path(sys.executable).parent}:{env.get('PATH', '')}"
    env["LD_LIBRARY_PATH"] = f"{prefix}/usr/lib/x86_64-linux-gnu"
    env["PERL5LIB"] = f"{prefix}/usr/share/perl5"
    versions = {
        "python": sys.version, "platform": platform.platform(),
        "pymupdf": pdf.VersionBind,
        "verifier": run([str(Path(sys.executable).parent / "pdf-verify"), "--version"], "version-verifier", env),
        "qpdf": run([str(prefix / "usr/bin/qpdf"), "--version"], "version-qpdf", env),
        "exiftool": run([str(prefix / "usr/bin/exiftool"), "-ver"], "version-exiftool", env),
    }
    (OUT / "versions.json").write_text(json.dumps(versions, ensure_ascii=False, indent=2) + "\n")
    rows = []
    for fixture in manifest:
        name = fixture["id"]
        path = ROOT / fixture["path"]
        report = OUT / f"{name}.verifier.json"
        verifier = run([str(Path(sys.executable).parent / "pdf-verify"), "--target", str(path),
                        "--secrets", str(rules), "--json", str(report)], f"{name}.verifier", env)
        xray = run(["/tmp/b-confirm-open-1-xray-venv/bin/xray", str(path)], f"{name}.xray", env)
        parsed = json.loads(report.read_text()) if report.exists() else {}
        rows.append({"fixture": fixture, "verifier_execution": verifier,
                     "verifier_report": parsed, "xray_execution": xray})
    summary = {"observed_at": "2026-10-01", "material": "本地构造，非客户材料",
               "script_seconds": round(time.perf_counter() - started, 3), "cases": rows}
    (OUT / "comparison.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"case_count": len(rows), "script_seconds": summary["script_seconds"],
                      "exitcodes": {r["fixture"]["id"]: r["verifier_execution"]["returncode"] for r in rows}}, indent=2))


if __name__ == "__main__":
    main()
