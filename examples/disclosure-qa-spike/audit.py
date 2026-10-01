"""核对真实实验数据与引用；不是产品安全认证或框架验收收据。"""
import datetime
import hashlib
import json
from pathlib import Path
import re

import verify

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/evaluation"


def main():
    errors = []
    checks = {}
    comparison = json.loads((OUT / "experiment/comparison.json").read_text())
    cases = comparison["cases"]
    checks["same_task_case_count"] = len(cases)
    counts = {}
    for case in cases:
        fixture = case["fixture"]
        path = ROOT / fixture["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != fixture["sha256"]:
            errors.append("输入摘要不一致：" + fixture["id"])
        report = case["verifier_report"]
        counts[report["verdict"]] = counts.get(report["verdict"], 0) + 1
        actual = json.loads((OUT / "experiment" / f"{fixture['id']}.verifier.json").read_text())
        if actual != report:
            errors.append("报告不一致：" + fixture["id"])
        if case["verifier_execution"]["returncode"] != report["exit_code"]:
            errors.append("退出码不一致：" + fixture["id"])
        for tool in ["verifier_execution", "xray_execution"]:
            for channel in ["stdout", "stderr"]:
                if not (OUT / "experiment" / case[tool][channel]).exists():
                    errors.append("缺少原始输出：" + fixture["id"])
    checks["verdict_counts"] = counts
    if counts != {"fail": 4, "uncertified": 6}:
        errors.append("结论计数不一致")
    retention = json.loads((OUT / "experiment/retention-results.json").read_text())
    expected = {"02-clean": (True, True), "11-overredacted": (False, True),
                "10-raster-clean": (False, False)}
    checks["retention_cases"] = len(retention["cases"])
    for case in retention["cases"]:
        constraint = case["positive_constraint"]
        actual = (constraint["public_fact_in_extracted_text"], constraint["searchable_text_present"])
        if actual != expected[case["id"]]:
            errors.append("保留真值不一致：" + case["id"])
        checks[case["id"]] = constraint["issue"]
        path = OUT / "experiment/inputs" / f"{case['id']}.pdf"
        if hashlib.sha256(path.read_bytes()).hexdigest() != case["sha256"]:
            errors.append("保留输入不一致：" + case["id"])
    links = 0
    for document in list(OUT.rglob("*.md")) + [ROOT / "projects/disclosure-qa-spike/README.md"]:
        if document.name == "baseline-README.md":
            continue
        for link in re.findall(r"\]\(([^)]+)\)", document.read_text()):
            if link.startswith(("http:", "https:", "#", "mailto:")):
                continue
            target = link.split("#")[0].strip("<>")
            if not (document.parent / target).exists():
                errors.append("本地链接失效：" + str(document.relative_to(ROOT)) + ":" + target)
            links += 1
    checks["local_links_checked"] = links
    source = json.loads((OUT / "experiment/baseline-source.json").read_text())
    original = Path(source["local_source"]) / "verify.py"
    installed = Path(verify.__file__)
    checks["verifier_source_sha256"] = hashlib.sha256(original.read_bytes()).hexdigest()
    checks["installed_verifier_sha256"] = hashlib.sha256(installed.read_bytes()).hexdigest()
    checks["source_equals_installed"] = checks["verifier_source_sha256"] == checks["installed_verifier_sha256"]
    if not checks["source_equals_installed"]:
        errors.append("原版源码与运行安装文件不同")
    checks["innovation_range"] = [sum(w * a / 4 for w, a in zip([35, 30, 20, 15], ratings))
                                  for ratings in [[2, 0, 1, 2], [3, 2, 3, 3]]]
    checks["commercial_range"] = [sum(w * a / 4 for w, a in zip([25, 25, 20, 20, 10], ratings))
                                  for ratings in [[2, 0, 1, 1, 1], [3, 2, 2, 2, 2]]]
    checks["construction_gate_passed"] = False
    record = {"type": "普通本地证据一致性检查，不是框架交付验收收据",
              "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "checks": checks, "errors": errors, "passed": not errors}
    (OUT / "AUDIT.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(record, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
