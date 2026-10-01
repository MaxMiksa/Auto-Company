"""Bounded journal projections of an Auto Company run.

Cycle identities come from program-owned ledgers. A consensus is the latest
work report, not proof of a running process or a stream of agent activity.
"""

from __future__ import annotations

import ctypes
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import json
import locale
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from typing import Any

from observability_data import artifact_projection, cycle_events, registered_artifacts

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "core"))
from cycle_reports import read_report  # noqa: E402
from project_metadata import read_metadata  # noqa: E402
from product_identity import continuation_project, cycle_projects, get_identity, list_cycle_projections  # noqa: E402
from product_identity import validate_state  # noqa: E402
from product_media import media_projection, read_resource  # noqa: E402


MAX_LEDGER_BYTES = 4 * 1024 * 1024
MAX_TEXT_BYTES = 256 * 1024
MAX_LOG_BYTES = 128 * 1024
MAX_CYCLES = 2000
CYCLE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
LANGUAGES = ("zh-CN", "en")


def timestamp(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return parsed.isoformat() if parsed.tzinfo is not None else None
    except ValueError:
        return None


def token_count(value: Any) -> int | None:
    return value if type(value) is int and 0 <= value <= 2**53 - 1 else None


def plain_text(value: str) -> str:
    value = re.sub(r"\[([^\[\]\r\n]+)\]\([^()[\]\r\n]*\)", r"\1", value)
    return re.sub(r"[*`#]", "", value).strip()


def sections(raw: str) -> dict[str, str]:
    result: dict[str, list[str]] = {}
    current = ""
    for line in raw.splitlines():
        if line.startswith(("## ", "##\t")):
            current = line[2:].strip().rstrip("#").strip().casefold()
            result.setdefault(current, [])
        elif current:
            result[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in result.items()}


def section(values: dict[str, str], *names: str) -> str:
    return next((values[name.casefold()] for name in names if name.casefold() in values), "")


def system_language() -> str:
    # Never launch shell commands to inspect the host from this preview.
    if os.name == "nt":
        try:
            value = locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), "en")
        except (AttributeError, OSError):
            value = "en"
    else:
        value = next((os.environ[key] for key in ("LC_ALL", "LC_MESSAGES", "LANG") if os.environ.get(key)), "en")
    return "zh-CN" if value.lower().startswith("zh") else "en"


@dataclass(frozen=True)
class ProductScope:
    """Explicit immutable identity, independent of root selection/configuration."""
    kind: str
    product_id: str | None = None
    exploration_id: str | None = None
    project: str | None = None


class JournalSource:
    def __init__(self, root: Path, language: str | None = None, *, scope: ProductScope | None = None):
        self.root = root.resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("Source must be a repository directory")
        if language is not None and language not in LANGUAGES:
            raise ValueError("Invalid preview language")
        self.preview_language = language
        self.scope = scope

    def identity_state(self):
        try:
            raw, truncated = self.read(".auto-company/product-state.json", MAX_LEDGER_BYTES)
        except FileNotFoundError:
            return {"identities": {}, "paths": {}, "cycles": {}}
        if truncated:
            raise ValueError("Product identity ledger exceeds supported read limit")
        return validate_state(json.loads(raw))

    def scoped_cycle_ids(self):
        if self.scope is None or self.scope.kind in {"legacy", "reference"}:
            return None
        state = self.identity_state()
        identity = self.scope.product_id or self.scope.exploration_id
        return {key for key, row in state["cycles"].items() if row["identityId"] == identity
                or (self.scope.product_id and state["identities"][row["identityId"]].get("linkedProductId") == identity)}

    def safe_path(self, relative: str) -> Path:
        if not relative or "\\" in relative or ":" in relative:
            raise ValueError("Invalid source path")
        parts = PurePosixPath(relative)
        if parts.is_absolute() or any(part in {"..", "."} for part in parts.parts):
            raise ValueError("Invalid source path")
        candidate = self.root
        for part in parts.parts:
            candidate /= part
            if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
                raise ValueError("Linked source files are not exposed")
            try:
                attributes = getattr(candidate.lstat(), "st_file_attributes", 0)
                if attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                    raise ValueError("Linked source files are not exposed")
            except FileNotFoundError:
                pass
        candidate.resolve().relative_to(self.root)
        return candidate

    def read(self, relative: str, limit: int = MAX_TEXT_BYTES, *, tail: bool = False) -> tuple[str, bool]:
        path = self.safe_path(relative)
        if not stat.S_ISREG(path.stat().st_mode):
            raise ValueError("Only regular source files are exposed")
        with path.open("rb") as source:
            if tail:
                source.seek(0, 2)
                size = source.tell()
                source.seek(max(0, size - limit))
                data = source.read(limit)
                truncated = size > limit
            else:
                data = source.read(limit + 1)
                truncated = len(data) > limit
                data = data[:limit]
        return data.decode("utf-8-sig", errors="replace"), truncated

    def optional(self, relative: str, limit: int = MAX_TEXT_BYTES) -> str:
        try:
            return self.read(relative, limit)[0]
        except (OSError, ValueError):
            return ""

    def pairs(self, relative: str) -> dict[str, str]:
        return {key: value.strip() for key, value in re.findall(
            r"^([A-Z][A-Z0-9_]*)=(.*)$", self.optional(relative, 32 * 1024), re.M)}

    def language(self) -> dict[str, Any]:
        if self.scope:
            # UI language is a view preference. A root-global language lock is
            # not evidence of an older identity's recorded product language.
            language = self.preview_language or system_language()
            evidence = self.product_language_evidence()
            return {"ok": True, "readOnly": True, "language": language,
                    "source": "view", "locked": False, "nextLanguage": language,
                    "nextSource": "view", "pending": False, "productId": self.scope.product_id,
                    "productLanguage": evidence["language"] if evidence else None,
                    "productLanguageStatus": "recorded" if evidence else "unknown",
                    "languagePeriodId": evidence["languagePeriodId"] if evidence else None,
                    "languageEvidence": evidence}
        settings = self.pairs(".auto-company.local")
        preference = settings.get("AUTO_COMPANY_LANGUAGE")
        preference = preference if preference in LANGUAGES else system_language()
        current = settings.get("AUTO_COMPANY_PRODUCT_LANGUAGE")
        locked = settings.get("AUTO_COMPANY_PRODUCT_STATUS") == "active" and current in LANGUAGES
        current = current if locked else preference
        if self.preview_language:
            current = self.preview_language
        return {"ok": True, "readOnly": True, "language": current,
                "source": "preview" if self.preview_language else "archive",
                "locked": locked, "nextLanguage": preference, "nextSource": "archive",
                "pending": current != preference, "productId": None}

    def product_language_evidence(self):
        """Actual cycle evidence, never a current root lock or queued plan."""
        if not self.scope or not self.scope.product_id:
            return None
        try:
            state = self.identity_state()
            cycles = [row for row in state['cycles'].values() if row['identityId'] == self.scope.product_id]
            cycles.sort(key=lambda row: row['productCycleNumber'], reverse=True)
            for cycle in cycles[:MAX_CYCLES]:
                try:
                    raw, truncated = self.read(f"logs/{cycle['cycleId']}.context.json", 4096)
                    context = json.loads(raw)
                    evidence = context.get('languageEvidence')
                    if (truncated or context.get('version') != 1 or context.get('source') != 'runtime_context'
                            or context.get('cycleId') != cycle['cycleId'] or context.get('project') != cycle['project']
                            or not timestamp(context.get('recordedAt')) or not isinstance(evidence, dict)
                            or evidence.get('schemaVersion') != 1 or evidence.get('productId') != self.scope.product_id
                            or evidence.get('cycleId') != cycle['cycleId'] or evidence.get('language') not in LANGUAGES
                            or not re.fullmatch(r'[0-9a-f]{32}', str(evidence.get('languagePeriodId', '')))
                            or not timestamp(evidence.get('recordedAt'))):
                        continue
                    return {key: evidence[key] for key in ('schemaVersion', 'productId', 'cycleId', 'language', 'languagePeriodId', 'recordedAt')}
                except (OSError, ValueError, TypeError, AttributeError, KeyError, RecursionError):
                    continue
        except (OSError, ValueError, TypeError, KeyError, RecursionError):
            pass
        return None

    def ledger(self) -> tuple[list[dict[str, Any]], list[str]]:
        warnings: list[str] = []
        try:
            raw, truncated = self.read("logs/usage.jsonl", MAX_LEDGER_BYTES, tail=True)
        except FileNotFoundError:
            return [], ["ledger_missing"]
        except (OSError, ValueError):
            return [], ["ledger_unavailable"]
        if truncated:
            warnings.append("ledger_truncated")
            # Keep recent work. The first tail line may begin mid-record.
            raw = raw.split("\n", 1)[1] if "\n" in raw else ""
        seen: dict[str, dict[str, Any]] = {}
        invalid = 0
        conflicting = 0
        conflict_ids = set()
        for line in raw.splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except (ValueError, RecursionError):
                invalid += 1
                continue
            if (not isinstance(record, dict) or record.get("kind") != "cycle_usage"
                    or type(record.get("schema_version")) is not int or record["schema_version"] != 1
                    or not isinstance(record.get("cycle_id"), str) or not CYCLE_ID.fullmatch(record["cycle_id"])
                    or type(record.get("cycle_number")) is not int or record["cycle_number"] < 1
                    or (record.get("project") is not None and
                        (not isinstance(record.get("project"), str)
                         or not re.fullmatch(r"projects/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", record["project"])) )):
                invalid += 1
                continue
            identity = record["cycle_id"]
            if identity in seen:
                if record != seen[identity]:
                    conflicting += 1
                    conflict_ids.add(identity)
                continue
            seen[identity] = record
        if invalid:
            warnings.append(f"ledger_invalid_records:{invalid}")
        if conflicting:
            warnings.append(f"ledger_conflicting_ids:{conflicting}")
        records = list(seen.values())
        if self.scope:
            allowed = self.scoped_cycle_ids()
            if allowed is not None:
                records = [record for record in records if record["cycle_id"] in allowed and record["cycle_id"] not in conflict_ids]
                warnings = [warning for warning in warnings if not warning.startswith('ledger_conflicting_ids:')]
                scoped_conflicts = len(conflict_ids & allowed)
                if scoped_conflicts:
                    warnings.append(f'ledger_conflicting_ids:{scoped_conflicts}')
        def order(record: dict[str, Any]) -> float:
            value = timestamp(record.get("started_at")) or timestamp(record.get("ended_at"))
            return datetime.fromisoformat(value).timestamp() if value else float("-inf")
        records.sort(key=order, reverse=True)
        if len(records) > MAX_CYCLES:
            warnings.append("cycle_list_truncated")
        return records[:MAX_CYCLES], warnings

    def documents(self, registered: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        delivery = self.optional("DELIVERY.md")
        registered = registered_artifacts(self) if registered is None else registered
        if self.scope:
            allowed = self.scoped_cycle_ids()
            return [item for item in registered
                    if (item.get("associationStatus") == "bound"
                        and (allowed is None or item.get("cycleId") in allowed))
                    or (item.get("kind") == "preview" and item.get("associationStatus") == "product"
                        and self.scope.product_id and item.get("productId") == self.scope.product_id)]
        # Root DELIVERY.md was the legacy archive convention. Once a product is
        # explicitly selected, only identity-bound runner records may surface.
        if self.project()["id"]:
            return registered
        if not delivery:
            return registered
        result = [{"label": "DELIVERY.md", "path": "DELIVERY.md", "kind": "document"}]
        # A single explicit relative README link identifies the delivered project.
        paths = set(re.findall(r"\]\((projects/[A-Za-z0-9_-]+/README\.md)\)", delivery))
        if len(paths) == 1:
            path = paths.pop()
            if self.optional(path):
                result.append({"label": path.split("/")[1] + " / README", "path": path, "kind": "document"})
        return result + registered

    def project(self) -> dict[str, Any]:
        """Return only selection-bound metadata; consensus is never identity."""
        selected = self.scope.project or "" if self.scope else self.pairs(".auto-company.local").get("ACTIVE_PROJECT", "")
        if not selected and not self.scope:
            try:
                selected = continuation_project(self.root)
            except (OSError, ValueError, TypeError):
                selected = ""
        if self.scope and self.scope.product_id:
            state = self.identity_state()
            try:
                current = get_identity(self.root, selected, create=False) if state["paths"].get(selected) == self.scope.product_id else None
            except (OSError, ValueError, TypeError):
                current = None
            if not current or current['id'] != self.scope.product_id:
                return {"id": selected or None, "name": selected.split("/")[-1] or "Auto Company",
                        "displayName": selected.split("/")[-1] or "Auto Company", "description": "",
                        "source": "identity_ledger", "status": "historical", "recordedAt": None}
        if not re.fullmatch(r"projects/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", selected):
            return {"id": None, "name": "Auto Company", "displayName": "Auto Company",
                    "description": "", "source": "workspace", "status": "unselected",
                    "recordedAt": None}
        fallback = selected.split("/", 1)[1]
        try:
            metadata = read_metadata(self.root, selected)
        except FileNotFoundError:
            return {"id": selected, "name": fallback, "displayName": fallback,
                    "description": "", "source": "selection", "status": "missing",
                    "recordedAt": None}
        except (OSError, ValueError, TypeError, RecursionError, OverflowError):
            return {"id": selected, "name": fallback, "displayName": fallback,
                    "description": "", "source": "project_metadata", "status": "invalid",
                    "recordedAt": None}
        return {"id": selected, "name": metadata["displayName"],
                "displayName": metadata["displayName"], "description": metadata["description"],
                "source": metadata["source"], "status": "recorded",
                "recordedAt": timestamp(metadata["recordedAt"])}

    def media_resource(self, product_id: str, name: str) -> tuple[bytes, str]:
        if self.scope and product_id != self.scope.product_id:
            raise FileNotFoundError("Media does not belong to this scope")
        result = read_resource(self.root, product_id, name)
        if result is None:
            raise FileNotFoundError("Registered media resource is unavailable")
        return result

    def persistent_cycles(self, cycles, project, warnings):
        """Merge identity-owned attempts without rewriting old usage records."""
        try:
            identity = get_identity(self.root, project["id"], create=False) if project["id"] else None
            if self.scope:
                identity = self.identity_state()["identities"].get(self.scope.product_id or self.scope.exploration_id)
        except (OSError, ValueError, TypeError, KeyError):
            warnings.append("product_cycle_identity_unavailable")
            identity = None
        projection_available = True
        try:
            projections = list_cycle_projections(self.root, limit=None)
            if self.scope:
                allowed = self.scoped_cycle_ids()
                if allowed is not None:
                    projections = list_cycle_projections(self.root, product_id=self.scope.product_id or self.scope.exploration_id, limit=None)
        except (OSError, ValueError, TypeError, KeyError):
            warnings.append("product_cycle_ledger_unavailable")
            projection_available = False
            projections = {"cycles": [], "total": 0}
        project["stableId"] = (self.scope.product_id if self.scope else identity["id"] if identity else None)
        rows = {row["cycleId"]: row for row in projections["cycles"]}
        known = {cycle["id"] for cycle in cycles}
        for row in rows.values():
            if row["cycleId"] in known:
                continue
            state = row["state"]
            # Pending attempts are never promoted to live execution from intent.
            status = {"reserved": "not_started", "dispatching": "startup_unconfirmed"}.get(state, state)
            cycles.append({"id": row["cycleId"], "number": row["productCycleNumber"],
                           "startedAt": timestamp(row.get("startedAt")), "reservedAt": timestamp(row["reservedAt"]),
                           "endedAt": timestamp(row.get("endedAt")), "status": status,
                           "durationReliable": False, "endedAtKind": "identity_ledger",
                           "engine": row.get("engine") or "unknown", "model": row.get("model") or "unknown",
                           "summary": "", "report": "", "active": False, "logAvailable": False,
                           "projectId": row.get("project") or None, "costUsd": None, "costStatus": "unavailable",
                           "budget": None, "usage": {"inputTokens": None, "outputTokens": None,
                                                      "totalTokens": None, "status": "unavailable"}})
        for cycle in cycles:
            row = rows.get(cycle["id"])
            cycle["runCycleNumber"] = cycle["number"]
            cycle["numbering"] = "persistent" if row else "legacy" if projection_available else "unavailable"
            if row:
                cycle.update(number=row["productCycleNumber"], sequenceNumber=row["sequenceNumber"], productCycleNumber=row["productCycleNumber"], runCycleNumber=row["runCycleNumber"],
                             stableProductId=row.get("productId"), identityKind=row["kind"],
                             linkedProductId=row.get("linkedProductId"), identityState=row["state"])
        cycles.sort(key=lambda cycle: (datetime.fromisoformat(cycle.get("startedAt") or cycle["reservedAt"]).timestamp() if cycle.get("startedAt") or cycle.get("reservedAt") else 0, cycle["id"]), reverse=True)
        if projections.get("total", 0) > len(rows):
            warnings.append("product_cycle_history_truncated")
        return {"mode": "persistent" if identity else "legacy" if projection_available else "unavailable", "productId": project["stableId"],
                "hasLegacy": any(cycle["numbering"] == "legacy" for cycle in cycles),
                "hasUnsequenced": any(cycle["numbering"] == "persistent" and cycle.get("sequenceNumber") is None for cycle in cycles),
                "total": projections.get("total", len(rows))}

    def cycle_context(self, identity: str) -> dict[str, Any]:
        """Read one program-owned cycle/project association."""
        try:
            raw, truncated = self.read(f"logs/{identity}.context.json", 4096)
            value = json.loads(raw)
            expected = {"version", "cycleId", "project", "recordedAt", "source"}
            if (truncated or not isinstance(value, dict) or not expected <= set(value) or set(value) - expected - {'languageEvidence'}
                    or value.get("version") != 1 or value.get("cycleId") != identity
                    or value.get("source") != "runtime_context" or not timestamp(value.get("recordedAt"))
                    or not isinstance(value.get("project"), str)
                    or (value["project"] and not re.fullmatch(r"projects/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", value["project"]))):
                raise ValueError("Invalid cycle context")
            return {"project": value["project"] or None, "status": "recorded",
                    "recordedAt": timestamp(value["recordedAt"]), "source": "runtime_context"}
        except FileNotFoundError:
            return {"project": None, "status": "missing", "recordedAt": None, "source": None}
        except (OSError, ValueError, TypeError, RecursionError, OverflowError):
            return {"project": None, "status": "invalid", "recordedAt": None, "source": "runtime_context"}

    def document(self, relative: str) -> tuple[str, bool]:
        allowed = {*(item["path"] for item in self.documents() if item.get("path") and item.get("available", True))}
        if not self.scope:
            allowed.add("memories/consensus.md")
        if relative not in allowed:
            raise ValueError("Document is not an advertised artifact")
        return self.read(relative)

    def project_status(self, cycle, project, recorded_project):
        # Paths describe historical locations; only the ledger can establish
        # continuity across a move or distinguish a replacement at that path.
        if self.scope and self.scope.kind == 'exploration' and cycle.get('identityKind') == 'exploration':
            return 'current'
        stable_id = cycle.get("stableProductId")
        if cycle.get("identityKind") == "exploration":
            stable_id = cycle.get("linkedProductId")
        if stable_id:
            return "current" if stable_id == project["stableId"] else "other"
        if project["stableId"] or cycle.get("numbering") == "unavailable":
            return "unknown"
        return "current" if recorded_project and recorded_project == project["id"] else "other" if recorded_project else "unknown"

    def active_cycle(self, status: dict[str, Any]) -> dict[str, Any] | None:
        """Join a live loop to its reserved identity, never infer from log names."""
        loop = status.get("parsed", {}).get("loop", {})
        pid = loop.get("pid")
        if (status.get("ok") is not True or loop.get("processState") != "running"
                or type(pid) is not int or pid < 1):
            return None
        try:
            state = self.pairs(".auto-loop-state")
            if (state.get("STATUS") != "running" or state != status.get("stateFile")
                    or self.read(".auto-loop.pid", 128)[0].strip() != str(pid)):
                return None
            raw, truncated = self.read("logs/usage.jsonl.pending", 32 * 1024)
            pending = json.loads(raw)
            if truncated or not isinstance(pending, dict):
                return None
            identity = pending.get("cycle_id")
            number = pending.get("cycle_number")
            started = timestamp(pending.get("started_at"))
            selected = self.project()["id"]
            context = self.cycle_context(identity) if isinstance(identity, str) and CYCLE_ID.fullmatch(identity) else {}
            if (type(pending.get("schema_version")) is not int or pending["schema_version"] != 1
                    or pending.get("kind") != "cycle_usage" or not isinstance(identity, str)
                    or not CYCLE_ID.fullmatch(identity) or type(number) is not int or number < 1
                    or str(number) != state.get("LOOP_COUNT") or not started
                    or context.get("status") != "recorded" or context.get("project") != selected
                    or any(not state.get(key) or pending.get(key.lower()) != state[key]
                           for key in ("ENGINE", "MODEL"))):
                return None
            # A previous launch's unfinished reservation is not the new loop's
            # active work, even when its cycle number happens to be the same.
            pid_time = self.safe_path(".auto-loop.pid").stat().st_mtime_ns
            if self.safe_path("logs/usage.jsonl.pending").stat().st_mtime_ns < pid_time:
                return None
            if (self.pairs(".auto-loop-state") != state
                    or self.read(".auto-loop.pid", 128)[0].strip() != str(pid)):
                return None
            try:
                available = self.safe_path(f"logs/{identity}.log").is_file()
            except (OSError, ValueError):
                available = False
            return {"id": identity, "number": number, "startedAt": started,
                    "endedAt": None, "status": "running", "active": True,
                    "durationReliable": False, "endedAtKind": "unavailable",
                    "engine": pending["engine"][:200], "model": pending["model"][:200],
                    "summary": "", "report": "", "logAvailable": available,
                    "projectId": context["project"], "projectIdentity": context,
                    "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None,
                              "status": "unavailable"}, "costUsd": None, "costStatus": "unavailable", "budget": None}
        except (OSError, ValueError, RecursionError):
            return None

    def log(self, identity: str, status: dict[str, Any] | None = None) -> dict[str, Any]:
        records, _ = self.ledger()
        active = self.active_cycle(status) if status is not None else None
        allowed = {record["cycle_id"] for record in records}
        if active:
            allowed.add(active["id"])
        if identity not in allowed:
            raise ValueError("Unknown cycle identity")
        try:
            text, truncated = self.read(f"logs/{identity}.log", MAX_LOG_BYTES, tail=True)
            return {"ok": True, "text": text, "available": True, "truncated": truncated}
        except (OSError, ValueError):
            return {"ok": True, "text": "", "available": False, "truncated": False}

    def log_tail(self, lines: int = 180) -> str:
        try:
            text, _ = self.read("logs/auto-loop.log", MAX_LOG_BYTES, tail=True)
            return "\n".join(text.splitlines()[-max(1, min(lines, 1000)):])
        except (OSError, ValueError):
            return ""

    def snapshot(self, *, status: dict[str, Any] | None = None,
                 language_state: dict[str, Any] | None = None,
                 detail_cycle_id: str | None = None) -> dict[str, Any]:
        generated = datetime.now(timezone.utc)
        generated_at = generated.isoformat()
        records, warnings = self.ledger()
        project = self.project()
        artifact_data = artifact_projection(self, project["id"] or "")
        registered = artifact_data["items"]
        if self.scope:
            registered = self.documents(registered)
        raw = ""
        updated_at = None
        try:
            raw, truncated = self.read("memories/consensus.md")
            updated_at = datetime.fromtimestamp(self.safe_path("memories/consensus.md").stat().st_mtime, timezone.utc).isoformat()
            if truncated:
                warnings.append("consensus_truncated")
        except (OSError, ValueError):
            warnings.append("consensus_unavailable")
        parts = sections(raw)
        progress = section(parts, "What We Did This Cycle", "本轮做了什么", "本轮完成的工作", "本周期工作", "本轮工作")
        progress_lines = [plain_text(re.sub(r"^\s*[-*+]\s+", "", line))
                          for line in progress.splitlines() if line.strip()]
        cycles: list[dict[str, Any]] = []
        for record in records:
            identity = record["cycle_id"]
            try:
                sidecar = json.loads(self.optional(f"logs/{identity}.json", 32 * 1024))
            except (ValueError, RecursionError):
                sidecar = {}
            report = sidecar.get("result", "") if isinstance(sidecar, dict) else ""
            report = report[:16000] if isinstance(report, str) else ""
            summary = plain_text(report.split("\n\n", 1)[0])[:500]
            usage = record.get("usage")
            usage = usage if isinstance(usage, dict) else {}
            counts = {target: token_count(usage.get(source)) for source, target in (
                ("input_tokens", "inputTokens"), ("output_tokens", "outputTokens"), ("total_tokens", "totalTokens"))}
            known = sum(value is not None for value in counts.values())
            try:
                available = self.safe_path(f"logs/{identity}.log").is_file()
            except (OSError, ValueError):
                available = False
            started = timestamp(record.get("started_at"))
            ended = timestamp(record.get("ended_at"))
            cycle_status = record.get("status")
            cycle_status = cycle_status if isinstance(cycle_status, str) and cycle_status in {"completed", "completed_with_timeout", "failed", "interrupted"} else "unknown"
            recovered = isinstance(record.get("source"), dict) and record["source"].get("type") == "cycle_recovery"
            cost = record.get("cost_usd")
            cost = cost if type(cost) in (int, float) and 0 <= cost <= 2**53 - 1 else None
            duration_reliable = bool(started and ended and cycle_status != "interrupted" and not recovered
                                     and not record.get("clock_anomaly")
                                     and datetime.fromisoformat(ended) >= datetime.fromisoformat(started))
            cycles.append({"id": identity, "number": record["cycle_number"],
                           "startedAt": started, "endedAt": ended, "status": cycle_status,
                           "durationReliable": duration_reliable, "endedAtKind": "recovered" if recovered else "observed",
                           "engine": record["engine"][:200] if isinstance(record.get("engine"), str) else "unknown",
                           "model": record["model"][:200] if isinstance(record.get("model"), str) else "unknown",
                           "summary": summary, "report": report, "logAvailable": available,
                           "projectId": record.get("project"),
                           "active": False, "costUsd": cost,
                           "costStatus": record.get("cost_usd_status", "reported") if cost is not None else "unavailable",
                           "budget": record.get("budget") if isinstance(record.get("budget"), dict) else None,
                           "usage": {**counts, "status": "reported" if known == 3 else "partial" if known else "unavailable"}})
        state = self.pairs(".auto-loop-state")
        selected_language = self.language() if language_state is None else language_state
        language = selected_language["language"]
        selected_project = project["id"]
        latest = cycles[0] if cycles else {}
        runtime = {"state": "stopped", "processState": "stopped", "pid": None,
                   "available": True, "error": None, "pauseReason": "",
                   "currentCycleId": None, "currentCycleNumber": None,
                   "active": False, "startedAt": None, "elapsedSeconds": None,
                   "elapsedReliable": False,
                   "engine": state.get("ENGINE") or latest.get("engine", "unknown"),
                   "model": state.get("MODEL") or latest.get("model", "unknown"),
                   "reasoning": "unknown", "language": language}
        if status is not None:
            loop = status.get("parsed", {}).get("loop", {})
            known = {"running", "idle", "paused", "waiting_limit", "circuit_break", "stopped", "failed"}
            available = status.get("ok") is True and loop.get("state") in known
            runtime.update({"state": loop.get("state") if available else "unavailable",
                            "processState": loop.get("processState", "unknown") if available else "unknown",
                            "available": available, "pid": loop.get("pid") if available else None,
                            "pauseReason": loop.get("pauseReason") or state.get("PAUSE_REASON", ""),
                            "error": None if available else (status.get("raw") or "Runtime status unavailable.")[:16000]})
            if available and runtime["state"] == "stopped" and status.get("parsed", {}).get("daemon", {}).get("state") == "failed":
                runtime["state"] = "failed"
            active = self.active_cycle(status)
            if active and active["id"] not in {cycle["id"] for cycle in cycles}:
                cycles.insert(0, active)
                runtime.update({"currentCycleId": active["id"], "currentCycleNumber": active["number"],
                                "active": True, "startedAt": active["startedAt"]})
            elif available and runtime["processState"] == "running":
                if runtime["state"] == "running":
                    warnings.append("active_cycle_unavailable")
            if not available:
                warnings.append("runtime_unavailable")
        numbering = self.persistent_cycles(cycles, project, warnings)
        if self.scope:
            # A root-global consensus, runtime config or budget cannot establish
            # ownership for a selected historical identity.
            raw, updated_at, parts, progress_lines = "", None, {}, []
            warnings.append("unscoped_consensus_omitted")
            runtime.update(state="unknown", processState="unknown", available=False,
                           engine="unknown", model="unknown", reasoning="unknown")
        if runtime["currentCycleId"]:
            current = next((cycle for cycle in cycles if cycle["id"] == runtime["currentCycleId"]), None)
            if current:
                runtime["currentCycleNumber"] = current.get("sequenceNumber") or current["number"]
                runtime["currentProductCycleNumber"] = current["number"]
        # On-demand history uses the same identity and artifact checks as the
        # initial detail window, before limited rows receive placeholder data.
        for index, cycle in enumerate(cycles):
            if index >= 30 and cycle["id"] != detail_cycle_id:
                continue
            cycle["detailStatus"] = "recorded"
            cycle.update(read_report(self, cycle))
            cycle.update(cycle_events(self, cycle))
            if cycle.get("active") or cycle["status"] == "interrupted":
                # Interrupted adapter sidecars can contain mixed raw JSONL.
                # Use only an explicit agent-message event as a work report.
                observed_report = next((event for event in reversed(cycle["events"])
                                        if event.get("kind") == "report" and isinstance(event.get("text"), str)), None)
                if observed_report:
                    cycle["report"] = observed_report["text"]
                    cycle["summary"] = plain_text(observed_report["text"].split("\n\n", 1)[0])[:500]
                    cycle["reportObservedAt"] = timestamp(observed_report.get("observedAt"))
                elif cycle["events"]:
                    cycle["report"] = cycle["summary"] = ""
            reported_project = cycle.get("workReport", {}).get("project") if isinstance(cycle.get("workReport"), dict) else None
            bound = [item for item in registered if item.get("cycleId") == cycle["id"] and item.get("associationStatus") == "bound"]
            context = cycle.get("projectIdentity") or self.cycle_context(cycle["id"])
            recorded_project = cycle.get("projectId")
            artifact_projects = {item.get("recordedProject", item["project"]) for item in bound}
            if context["status"] == "recorded":
                cycle_project = context["project"]
            elif context["status"] == "missing" and recorded_project:
                cycle_project = recorded_project
                context = {"project": recorded_project, "status": "recorded",
                           "recordedAt": None, "source": "usage_ledger"}
            elif context["status"] == "missing" and len(artifact_projects) == 1:
                cycle_project = next(iter(artifact_projects))
                context = {"project": cycle_project, "status": "recorded",
                           "recordedAt": bound[0].get("recordedAt"), "source": "runner"}
            else:
                cycle_project = None
            if cycle.get("identityKind") == "exploration" and cycle.get("linkedProductId") == project["stableId"] and project["stableId"]:
                try:
                    if selected_project in cycle_projects(self.root, cycle["id"]):
                        # Preserve the recorded product location for report
                        # validation; the stable link decides current ownership.
                        cycle_project = cycle_project or (next(iter(artifact_projects)) if len(artifact_projects) == 1 else selected_project)
                        context = {"project": cycle_project, "status": "recorded", "recordedAt": None,
                                   "source": "product_cycle_ledger", "kind": "linked_exploration",
                                   "currentProject": selected_project}
                except (OSError, ValueError, TypeError, KeyError):
                    warnings.append("exploration_association_unavailable")
            if cycle_project and reported_project and reported_project != cycle_project:
                cycle["workReport"] = None
                cycle["workReportStatus"] = "identity_mismatch"
            cycle["projectId"] = cycle_project
            cycle["projectIdentity"] = context
            cycle["projectStatus"] = self.project_status(cycle, project, cycle_project)
            cycle["belongsToCurrentProject"] = cycle["projectStatus"] == "current"
            cycle_artifacts = bound if cycle["belongsToCurrentProject"] else []
            checks = [item for item in cycle_artifacts if item["kind"] == "check"]
            cycle["artifacts"] = cycle_artifacts
            cycle["checks"] = checks
            cycle["latestCheck"] = checks[0] if checks else None
            cycle["checkStatus"] = checks[0]["evidenceStatus"] if checks else "unregistered"
        if len(cycles) > 30:
            warnings.append("cycle_details_truncated")
        for cycle in cycles[30:]:
            if cycle["id"] == detail_cycle_id:
                continue
            recorded_project = cycle.get("projectId")
            cycle.update({"detailStatus": "limited", "projectIdentity": {
                              "project": recorded_project, "status": "recorded" if recorded_project else "not_loaded",
                              "recordedAt": None, "source": "usage_ledger" if recorded_project else None},
                          "projectStatus": self.project_status(cycle, project, recorded_project),
                          "artifacts": [], "checks": [], "latestCheck": None,
                          "checkStatus": "unregistered"})
            cycle["belongsToCurrentProject"] = cycle["projectStatus"] == "current"
        if cycles:
            observed_cycle = next((cycle for cycle in cycles if cycle.get("projectStatus") == "current"), None)
            observed = observed_cycle.get("observedConfig") if observed_cycle else None
            if observed:
                runtime.update(model=observed["model"], reasoning=observed["reasoning"], configSource="session_context")
        if runtime["active"] and runtime["startedAt"]:
            started = datetime.fromisoformat(runtime["startedAt"])
            if started <= generated:
                runtime["elapsedSeconds"] = int((generated - started).total_seconds())
                runtime["elapsedReliable"] = True
        recorded_budget = next((record["budget"] for record in records if isinstance(record.get("budget"), dict)), None)
        latest_check = next((item for item in registered if item["kind"] == "check" and item.get("cycleId") and item.get("associationStatus") == "bound"), None)
        latest_project_cycle = next((cycle for cycle in cycles if cycle.get("projectStatus") == "current"), None)
        try:
            media_owned = not self.scope or (self.scope.product_id and self.identity_state()["paths"].get(selected_project) == self.scope.product_id)
            product_media = media_projection(self.root, selected_project, readonly=status is None) if selected_project and media_owned else None
        except (OSError, ValueError, TypeError, KeyError):
            product_media = None
            warnings.append("product_media_unavailable")
        return {"ok": True, "readOnly": status is None, "sourceName": self.root.name,
                "legacyAvailable": False, "languageState": selected_language,
                "status": status, "recordedBudget": recorded_budget,
                "generatedAt": generated_at, "language": language,
                "project": project,
                "cycleNumbering": numbering, "productMedia": product_media,
                "runtime": runtime,
                "consensus": {"updatedAt": updated_at,
                              "reportedUpdatedAt": timestamp(section(parts, "Last Updated", "最后更新", "最近更新")),
                              "phase": section(parts, "Current Phase", "当前阶段"), "progress": progress_lines,
                              "raw": raw},
                "cycles": cycles, "artifacts": self.documents(registered),
                "artifactCollection": {key: value for key, value in artifact_data.items() if key != "items"},
                "latestCheck": latest_check,
                "latestProjectCycleId": latest_project_cycle["id"] if latest_project_cycle else None,
                "warnings": warnings}

    def legacy_status(self) -> dict[str, Any]:
        snapshot = self.snapshot()
        state = self.pairs(".auto-loop-state")
        return {"ok": True, "readOnly": True, "timestamp": snapshot["generatedAt"], "exitCode": 0, "elapsedMs": 0,
                "raw": "Read-only archive preview. Host services are not queried.", "stateFile": {**state, "STATUS": "stopped"},
                "parsed": {"guardian": {"state": "unavailable", "pid": None},
                           "daemon": {"state": "unavailable", "mainPid": None},
                           "autostart": {"state": "unavailable", "enabledState": "unknown"},
                           "loop": {"state": "stopped", "processState": "stopped", "pid": None,
                                    "engine": snapshot["runtime"]["engine"], "model": snapshot["runtime"]["model"],
                                    "loopCount": state.get("LOOP_COUNT", ""), "errorCount": state.get("ERROR_COUNT", ""),
                                    "lastRun": state.get("LAST_RUN", ""), "pauseReason": ""}},
                "consensusHead": snapshot["consensus"]["raw"], "logTail": self.log_tail()}

    def legacy_usage(self, period: str = "day", target_date: str | None = None) -> dict[str, Any]:
        if period not in {"day", "week"}:
            raise ValueError("Period must be day or week")
        target = date.fromisoformat(target_date) if target_date else datetime.now().astimezone().date()
        start = target if period == "day" else target - timedelta(days=target.weekday())
        end = start if period == "day" else start + timedelta(days=6)
        records, warnings = self.ledger()
        selected = [record for record in records if timestamp(record.get("ended_at"))
                    and start <= datetime.fromisoformat(timestamp(record["ended_at"])).date() <= end]
        def metric(field: str) -> dict[str, Any]:
            values = [token_count(record.get("usage", {}).get(field))
                      if isinstance(record.get("usage"), dict) else None for record in selected]
            known = [value for value in values if value is not None]
            return {"value": sum(known) if known else None,
                    "status": "complete" if known and len(known) == len(values) else "partial" if known else "unavailable",
                    "known_cycles": len(known), "unknown_cycles": len(values) - len(known)}
        return {"ok": True, "readOnly": True, "timestamp": datetime.now(timezone.utc).isoformat(), "budgetPause": None,
                "summary": {"schema_version": 1, "period": period, "start_date": start.isoformat(), "end_date": end.isoformat(),
                            "cycles": len(selected), "usage": {field: metric(field) for field in ("input_tokens", "output_tokens", "total_tokens")},
                            "cost_usd": {"value": None, "status": "unavailable", "known_cycles": 0, "unknown_cycles": len(selected)},
                            "latest_budget": None, "invalid_records": len(warnings)}}
