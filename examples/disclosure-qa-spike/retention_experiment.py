"""仅验证预先声明的公开事实保留，不能判断任意披露意图。"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from pypdf import PdfReader
import pymupdf as pdf

from experiment import INPUTS, OUT, PUBLIC, ROOT, SECRET, base, redact, run, save


def main():
    start = time.perf_counter()
    doc = base(True)
    redact(doc)
    rects = doc[0].search_for(PUBLIC)
    for rect in rects:
        doc[0].add_redact_annot(rect, fill=(0, 0, 0))
    doc[0].apply_redactions()
    doc.scrub()
    save(doc, "11-overredacted")

    env = os.environ.copy()
    env["PATH"] = f"/tmp/b-confirm-open-1-baseline/bin:{Path(sys.executable).parent}:{env.get('PATH', '')}"
    results = []
    for name, truth in [
        ("02-clean", "公开事实保留，文字可检索"),
        ("11-overredacted", "公开事实误删，但没有秘密泄漏"),
        ("10-raster-clean", "公开事实肉眼可见，但文字无法检索"),
    ]:
        path = INPUTS / f"{name}.pdf"
        report = OUT / f"{name}.retention-baseline.json"
        execution = run([str(Path(sys.executable).parent / "pdf-verify"), "--target", str(path),
                         "--secrets", str(OUT / "secrets.json"), "--json", str(report)],
                        f"{name}.retention-baseline", env)
        probe_start = time.perf_counter()
        reader = PdfReader(path)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        present = PUBLIC in text
        readable = bool(text.strip())
        result = {
            "id": name, "truth": truth, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "baseline_execution": execution, "baseline_report": json.loads(report.read_text()),
            "positive_constraint": {"required_public_fact": PUBLIC,
                "public_fact_in_extracted_text": present, "searchable_text_present": readable,
                "issue": "没有发现本项保留回归" if present else (
                    "缺少事先批准公开的信息，需要复核" if readable else "无可检索文字层，需要复核"),
                "scope": "pypdf抽取+事先明确事实；不证明整体内容正确或安全",
                "seconds": round(time.perf_counter() - probe_start, 6)},
            "extracted_text": text,
        }
        results.append(result)

    # 提取实际存储的原图，证明视觉遮盖不等于删除底层图像；没有运行OCR。
    with pdf.open(INPUTS / "08-image-cover.pdf") as doc:
        xref = doc[0].get_images()[0][0]
        extracted = doc.extract_image(xref)
        (OUT / "recovered-image.png").write_bytes(extracted["image"])
        doc[0].get_pixmap(matrix=pdf.Matrix(1, 1)).save(OUT / "covered-page.png")
    with pdf.open(INPUTS / "10-raster-clean.pdf") as doc:
        doc[0].get_pixmap(matrix=pdf.Matrix(1, 1)).save(OUT / "raster-public-page.png")

    outcome = {"observed_at": "2026-10-01", "secret_rules_unchanged": True,
               "total_seconds": round(time.perf_counter() - start, 3), "cases": results,
               "not_user_behavior": True, "not_safety_certification": True}
    (OUT / "retention-results.json").write_text(json.dumps(outcome, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"total_seconds": outcome["total_seconds"],
                      "cases": [{"id": r["id"], "baseline": r["baseline_report"]["verdict"],
                                  "positive_constraint": r["positive_constraint"]["issue"]}
                                 for r in results]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
