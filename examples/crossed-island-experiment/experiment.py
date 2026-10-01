"""回放纸面规则并列出消融观察，不模拟人的偏好或购买。"""

import argparse
import copy
import datetime
import itertools
import json
from pathlib import Path
import time


def play(material, choice):
    authors = material["authors"]
    for role in ("A", "B"):
        for field in ("name", "landmark", "reason", "rule", "prediction"):
            if not isinstance(authors[role][field], str) or not authors[role][field].strip():
                raise ValueError(f"{role} 的 {field} 为空，请保留作品并补充虚构素材。")
    light, tide = authors["A"]["rule"], authors["B"]["rule"]
    if light not in ("月光", "日光") or tide not in ("退潮", "涨潮"):
        raise ValueError("当前样本只支持卡片列出的光照与潮汐规则。")
    if material["budget"] != 2 or choice not in material["choices"]:
        raise ValueError("请按两枚筹码和共同规则选择，不要覆盖先前记录。")
    a_action = "踏浅滩送物" if tide == "退潮" else "搭潮汐浮台送物"
    b_action = "夜间递灯" if light == "月光" else "晨间反光"
    path = ("夜间" if light == "月光" else "清晨") + ("浅滩" if tide == "退潮" else "浮台")
    mechanism = {"A_available": [a_action], "B_available": [b_action],
                 "feasible_path": path, "decision": choice,
                 "spent": 0 if choice == "停在这里" else 2,
                 "landmarks_intact": choice != "留路", "island_exit": choice == "留路",
                 "common_ending": choice != "停在这里"}
    trace = [{"node": 1, "stage": "分别创造并封存", "records": copy.deepcopy(authors)},
             {"node": 2, "stage": "交换条件，进入对方世界，再共同揭晓", "A_action": a_action, "B_action": b_action},
             {"node": 3, "stage": "共同取舍或退出", "state": mechanism}]
    if choice == "留路":
        ending = f"把{authors['A']['landmark']}与{authors['B']['landmark']}的原形改为{path}通路；保留原句与名字，失去两件原物。"
    elif choice == "留物":
        ending = f"各修复{authors['A']['landmark']}与{authors['B']['landmark']}；保留原句与两幅图，失去离岛路。"
    else:
        ending = "保留独立图及原句、预测、未作出的共同取舍；没有共同结局。"
    return {"trace": trace, "mechanism": mechanism, "ending": ending,
            "original_sentences": {r: authors[r]["reason"] for r in ("A", "B")}}


def evaluate():
    material = json.loads(Path(__file__).with_name("sample.json").read_text())
    started = time.perf_counter()
    runs = {c: play(material, c) for c in material["choices"]}
    combinations = []
    for light, tide in itertools.product(("月光", "日光"), ("退潮", "涨潮")):
        variant = copy.deepcopy(material)
        variant["authors"]["A"]["rule"], variant["authors"]["B"]["rule"] = light, tide
        combinations.append({"light": light, "tide": tide, "observed": play(variant, "留路")["mechanism"]})
    swapped = copy.deepcopy(material)
    swapped["authors"]["A"]["reason"], swapped["authors"]["B"]["reason"] = (
        swapped["authors"]["B"]["reason"], swapped["authors"]["A"]["reason"])
    placeholder = copy.deepcopy(material)
    for role in ("A", "B"):
        placeholder["authors"][role]["reason"] = "这里是一句占位表达。"
    base = runs["留路"]["mechanism"]
    expression = {"swapped": play(swapped, "留路"), "placeholder": play(placeholder, "留路")}
    expression["swapped_changes_mechanism"] = expression["swapped"]["mechanism"] != base
    expression["placeholder_changes_mechanism"] = expression["placeholder"]["mechanism"] != base
    invalid = copy.deepcopy(material)
    invalid["authors"]["B"]["reason"] = ""
    try:
        play(invalid, "留路")
        invalid_result = "意外接受空素材"
    except ValueError as error:
        invalid_result = str(error)
    return {"observed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "provenance": material["provenance"], "primary_runs": runs,
            "environment_ablation": combinations, "expression_ablation": expression,
            "invalid_input_observation": invalid_result,
            "machine_seconds": time.perf_counter() - started,
            "limits": "只有规则观察；没有真实双人、愉悦、玩家完成时长或购买证据。"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="交错岛有限规则回放")
    parser.add_argument("--out", required=True, type=Path, help="保存观察 JSON 的位置")
    args = parser.parse_args()
    result = evaluate()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"saved": str(args.out), "runs": len(result["primary_runs"]),
                      "environments": len(result["environment_ablation"]),
                      "free_sentences_change_mechanism": result["expression_ablation"]["swapped_changes_mechanism"],
                      "seconds": result["machine_seconds"]}, ensure_ascii=False))
