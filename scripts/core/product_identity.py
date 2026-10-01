"""Durable product identities and cycle reservations, independent of log retention.

The runtime store is authoritative. A small source marker only detects path
reuse and supports explicit relocation; it never supplies counters or history.
Readers do not create directories, identities, locks or projection sidecars.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import uuid

ID = re.compile(r"[0-9a-f]{32}\Z")
CYCLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
PROJECT = re.compile(r"projects/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\Z")
OPEN = {"reserved", "dispatching"}
TERMINAL = {"completed", "completed_with_timeout", "failed", "interrupted", "not_started", "startup_unconfirmed"}


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_path(root, relative):
    root = Path(root).resolve()
    path = root
    for part in Path(relative).parts:
        if part in {"..", "."} or ":" in part:
            raise ValueError("Invalid product state path")
        path /= part
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ValueError("Product state and source paths must not be links")
    path.resolve().relative_to(root)
    return path


def project_value(project):
    project = str(project or "")
    if project and not project.startswith("projects/"):
        project = "projects/" + project
    if project and not PROJECT.fullmatch(project):
        raise ValueError("Invalid product project path")
    return project


def atomic_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix=".product-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(data, output, ensure_ascii=False, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                try:
                    os.fsync(directory)
                except OSError:
                    # Some mounted filesystems do not implement directory fsync.
                    pass
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def empty_state():
    return {"schemaVersion": 1, "identities": {}, "paths": {}, "cycles": {},
            "explorationId": None, "continuationProductId": None}


def read_state(root):
    path = safe_path(root, ".auto-company/product-state.json")
    if not path.exists():
        return empty_state()
    try:
        return validate_state(json.loads(path.read_text(encoding="utf-8")))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid product state; refusing to reset cycle numbering") from error


def validate_state(state):
    try:
        if state.get("schemaVersion") != 1:
            raise ValueError("Unsupported product state schema")
        for key in ("identities", "paths", "cycles"):
            if not isinstance(state.get(key), dict):
                raise ValueError("Invalid product state")
        for identity, item in state["identities"].items():
            if (not ID.fullmatch(identity) or item["id"] != identity
                    or item["kind"] not in {"product", "exploration"}
                    or type(item["lastCycleNumber"]) is not int or item["lastCycleNumber"] < 0
                    or project_value(item["project"]) != item["project"]):
                raise ValueError("Invalid product identity")
        seen = set()
        for cycle_id, row in state["cycles"].items():
            owner = state["identities"].get(row["identityId"])
            pair = (row["identityId"], row["productCycleNumber"])
            if (not CYCLE.fullmatch(cycle_id) or row["cycleId"] != cycle_id or not owner
                    or row["state"] not in OPEN | TERMINAL or pair in seen
                    or type(row["productCycleNumber"]) is not int
                    or not 1 <= row["productCycleNumber"] <= owner["lastCycleNumber"]):
                raise ValueError("Invalid cycle reservation")
            seen.add(pair)
        for project, identity in state["paths"].items():
            if (project_value(project) != project or not project
                    or state["identities"][identity]["project"] != project):
                raise ValueError("Invalid source binding")
        for key in ("explorationId", "continuationProductId"):
            if state.get(key) is not None and state[key] not in state["identities"]:
                raise ValueError("Invalid runtime continuation")
        return state
    except (KeyError, TypeError, AttributeError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid product state; refusing to reset cycle numbering") from error


def state_hash(state):
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()


def recover_transaction(root):
    """Redo a committed transaction intent after a stopped-writer lock recovery."""
    path = safe_path(root, ".auto-company/product-state.transaction.json")
    if not path.exists():
        return
    intent = json.loads(path.read_text(encoding="utf-8"))
    state = validate_state(intent["after"])
    current = read_state(root)
    if state_hash(current) not in {intent["beforeHash"], state_hash(state)}:
        raise ValueError("Product transaction conflicts with current state; refusing to overwrite")
    for marker in intent["markers"]:
        project = project_value(marker["project"])
        if not project or not safe_path(root, project).is_dir() or not ID.fullmatch(marker["id"]):
            raise ValueError("Pending product source registration cannot be recovered")
        current_id = _marker_id(root, project)
        previous = marker["previous"]
        if current_id not in {marker["id"], previous["id"] if previous else None}:
            raise ValueError("Pending source identity changed during recovery")
        target = _marker(root, project)
        target.parent.mkdir(exist_ok=True)
        atomic_write(target, {"schemaVersion": 1, "id": marker["id"]})
    atomic_write(safe_path(root, ".auto-company/product-state.json"), state)
    path.unlink()


def commit_transaction(root, before, state, markers):
    path = safe_path(root, ".auto-company/product-state.transaction.json")
    committed = False
    try:
        # Stage marker changes and the complete reservation together before any
        # source mutation. A crash can redo this intent, never reset a counter.
        atomic_write(path, {"schemaVersion": 1, "beforeHash": state_hash(before),
                            "after": state, "markers": markers})
        for marker in markers:
            target = _marker(root, marker["project"])
            target.parent.mkdir(exist_ok=True)
            atomic_write(target, {"schemaVersion": 1, "id": marker["id"]})
        atomic_write(safe_path(root, ".auto-company/product-state.json"), state)
        committed = True
        path.unlink()
    except Exception:
        if not committed:
            for marker in reversed(markers):
                target = _marker(root, marker["project"])
                if marker["previous"] is None:
                    target.unlink(missing_ok=True)
                else:
                    atomic_write(target, marker["previous"])
            path.unlink(missing_ok=True)
        raise


@contextmanager
def transaction(root, timeout=5):
    folder = safe_path(root, ".auto-company")
    folder.mkdir(exist_ok=True)
    lock = safe_path(root, ".auto-company/product-state.lock")
    deadline = time.monotonic() + timeout
    while True:
        try:
            lock.mkdir()
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise ValueError("Product state is busy; after stopping all writers, use recover-lock --confirm STOPPED")
            time.sleep(0.025)
    try:
        recover_transaction(root)
        state = read_state(root)
        before = json.loads(json.dumps(state))
        markers = []
        state["_pendingMarkers"] = markers
        yield state
        del state["_pendingMarkers"]
        commit_transaction(root, before, state, markers)
    finally:
        lock.rmdir()


def _marker(root, project):
    return safe_path(root, project + "/.auto-company/identity.json")


def _marker_id(root, project):
    path = _marker(root, project)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schemaVersion") != 1 or not ID.fullmatch(value.get("id", "")):
            raise ValueError("Invalid product source marker")
        return value["id"]
    except (AttributeError, TypeError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid product source marker") from error


def _identity(root, state, project, create=False, replace_source=False):
    project = project_value(project)
    if not project:
        identity = state.get("explorationId")
        if identity:
            return state["identities"][identity]
    else:
        source = safe_path(root, project)
        if not source.is_dir():
            raise ValueError("Registered product source is missing")
        identity = state["paths"].get(project)
        marker = _marker_id(root, project)
        if identity:
            item = state["identities"][identity]
            if marker == identity:
                return item
            # A replacement directory cannot inherit an earlier product's ID.
            if not create:
                return None
            if not replace_source:
                raise ValueError("Product source identity is missing or changed; explicitly register a replacement")
        elif marker:
            raise ValueError("Source marker has no matching path registration; relocate explicitly")
    if not create:
        return None
    identity = uuid.uuid4().hex
    item = {"id": identity, "kind": "product" if project else "exploration", "project": project,
            "createdAt": now(), "lastCycleNumber": 0, "source": "runtime_registration"}
    if project:
        marker = _marker(root, project)
        previous = json.loads(marker.read_text(encoding="utf-8")) if marker.exists() else None
        state["_pendingMarkers"].append({"project": project, "id": identity, "previous": previous})
        state["paths"][project] = identity
    else:
        state["explorationId"] = identity
    state["identities"][identity] = item
    return item


def get_identity(root, project, create=False):
    """Return the authoritative identity, or None; reads never register sources."""
    if create:
        with transaction(root) as state:
            return dict(_identity(root, state, project, True))
    return _identity(root, read_state(root), project)


def continuation_project(root):
    state = read_state(root)
    identity = state.get("continuationProductId")
    if not identity:
        return ""
    item = state["identities"][identity]
    current = _identity(root, state, item["project"])
    if not current or current["id"] != identity:
        raise ValueError("Runtime continuation source no longer matches its product")
    return item["project"]


def register_project(root, project, cycle_id=""):
    """Explicit creation links one exploration task to its created product."""
    with transaction(root) as state:
        if cycle_id:
            cycle = state["cycles"].get(cycle_id)
            if not cycle or cycle["state"] not in OPEN:
                raise ValueError("Creation requires an open runtime cycle")
            owner = state["identities"][cycle["identityId"]]
            linked = owner.get("linkedProductId")
            if linked and state["identities"][linked]["project"] != project_value(project):
                raise ValueError("Exploration already linked to a product; do not infer another execution target")
        item = _identity(root, state, project, True, replace_source=True)
        if cycle_id:
            cycle.setdefault("createdProductIds", [])
            if item["id"] not in cycle["createdProductIds"]:
                cycle["createdProductIds"].append(item["id"])
            owner = state["identities"][cycle["identityId"]]
            if owner["kind"] == "exploration":
                if owner.get("linkedProductId") not in (None, item["id"]):
                    raise ValueError("Exploration already linked to a product; do not infer another execution target")
                owner["linkedProductId"] = item["id"]
                item["explorationId"] = owner["id"]
                state["continuationProductId"] = item["id"]
        return dict(item)


def relocate_identity(root, identity, project):
    """Explicit path update; a source marker must already prove the same ID."""
    project = project_value(project)
    if not project:
        raise ValueError("Relocation requires a product path")
    with transaction(root) as state:
        item = state["identities"].get(identity)
        if not item or item["kind"] != "product" or _marker_id(root, project) != identity:
            raise ValueError("Relocation source does not match the registered product")
        if state["paths"].get(project) not in (None, identity):
            raise ValueError("Relocation target is already registered")
        if state["paths"].get(item["project"]) == identity:
            del state["paths"][item["project"]]
        item["project"] = project
        state["paths"][project] = identity
        return dict(item)


def _sequence_offsets(state):
    """Use explicit creation boundaries, never retained log/page counts."""
    offsets = {}
    for row in state["cycles"].values():
        owner = state["identities"][row["identityId"]]
        product_id = owner.get("linkedProductId")
        product = state["identities"].get(product_id, {})
        if (owner["kind"] == "exploration" and product.get("kind") == "product"
                and product.get("explorationId") == owner["id"]
                and product_id in row.get("createdProductIds", [])
                and product.get("createdAt", "") >= row["reservedAt"]):
            offsets[product_id] = min(offsets.get(product_id, row["productCycleNumber"]), row["productCycleNumber"])
    return offsets


def _projection(state, row, offsets=None):
    owner = state["identities"][row["identityId"]]
    offsets = _sequence_offsets(state) if offsets is None else offsets
    sequence = row["productCycleNumber"]
    if owner["kind"] == "product" and owner.get("explorationId"):
        offset = offsets.get(owner["id"])
        sequence = sequence + offset if offset is not None else None
    elif owner["kind"] == "exploration" and owner.get("linkedProductId"):
        offset = offsets.get(owner["linkedProductId"])
        if offset is None or sequence > offset:
            sequence = None
    return {**row, "schemaVersion": 1, "numbering": "persistent", "kind": owner["kind"],
            "sequenceNumber": sequence,
            "productId": owner["id"] if owner["kind"] == "product" else None,
            "explorationId": owner["id"] if owner["kind"] == "exploration" else owner.get("explorationId"),
            "linkedProductId": owner.get("linkedProductId"),
            "source": "product_cycle_ledger"}


def cycle_projection(root, cycle_id):
    state = read_state(root)
    row = state["cycles"].get(cycle_id)
    return _projection(state, row) if row else None


def cycle_projects(root, cycle_id):
    state = read_state(root)
    row = state["cycles"].get(cycle_id)
    if not row:
        return []
    ids = [row["identityId"], *row.get("createdProductIds", [])]
    return list(dict.fromkeys(state["identities"][identity]["project"] for identity in ids
                             if state["identities"][identity]["kind"] == "product"))


def list_cycle_projections(root, product_id=None, limit=200, before=None):
    state = read_state(root)
    limit = max(1, min(int(limit), 2000)) if limit is not None else None
    rows = []
    for row in state["cycles"].values():
        owner = state["identities"][row["identityId"]]
        if product_id and owner["id"] != product_id and owner.get("linkedProductId") != product_id:
            continue
        rows.append(row)
    rows.sort(key=lambda row: (row["reservedAt"], row["cycleId"]), reverse=True)
    total = len(rows)
    if before:
        position = next((index for index, row in enumerate(rows) if row["cycleId"] == before), None)
        if position is None:
            raise ValueError("Unknown cycle cursor")
        rows = rows[position + 1:]
    selected = rows[:limit]
    offsets = _sequence_offsets(state)
    return {"cycles": [_projection(state, row, offsets) for row in selected], "total": total,
            "nextBefore": selected[-1]["cycleId"] if limit is not None and len(rows) > limit else None}


def reserve_cycle(root, project, attempt_id, run_cycle_number, engine="", model=""):
    if not CYCLE.fullmatch(attempt_id) or type(run_cycle_number) is not int or run_cycle_number < 1:
        raise ValueError("Invalid cycle attempt")
    project = project_value(project)
    with transaction(root) as state:
        previous = next((row for row in state["cycles"].values() if row["attemptId"] == attempt_id), None)
        if previous:
            if previous["project"] != project or previous["runCycleNumber"] != run_cycle_number:
                raise ValueError("Cycle attempt was already reserved with different context")
            return _projection(state, previous)
        if any(row["state"] in OPEN for row in state["cycles"].values()):
            raise ValueError("Recover the unfinished cycle before reserving another attempt")
        item = _identity(root, state, project, True)
        item["lastCycleNumber"] += 1
        cycle_id = "cycle-" + uuid.uuid4().hex
        row = {"cycleId": cycle_id, "attemptId": attempt_id, "identityId": item["id"],
               "project": project, "productCycleNumber": item["lastCycleNumber"],
               "runCycleNumber": run_cycle_number, "reservedAt": now(), "startedAt": None,
               "endedAt": None, "state": "reserved", "engine": engine, "model": model}
        state["cycles"][cycle_id] = row
        return _projection(state, row)


def update_cycle(root, cycle_id, status, reason=""):
    if status not in {"dispatching"} | TERMINAL:
        raise ValueError("Invalid cycle state")
    with transaction(root) as state:
        row = state["cycles"].get(cycle_id)
        if not row:
            raise ValueError("Unknown cycle identity")
        if row["state"] in TERMINAL:
            if row["state"] != status:
                raise ValueError("A closed cycle cannot be relabeled")
            return _projection(state, row)
        row["state"] = status
        if status == "dispatching":
            row["dispatchAt"] = now()
        else:
            if status in {"completed", "completed_with_timeout", "failed"}:
                row["startedAt"] = row.get("dispatchAt")
            row["endedAt"] = now()
            row["reason"] = reason[:1000]
        return _projection(state, row)


def recover_cycles(root):
    """Caller holds the loop ownership lock; never replay an uncertain attempt."""
    if not any(safe_path(root, ".auto-company/" + name).exists()
               for name in ("product-state.json", "product-state.transaction.json")):
        return []
    recovered = []
    with transaction(root) as state:
        completed = {}
        usage = safe_path(root, "logs/usage.jsonl")
        if usage.is_file():
            with usage.open(encoding="utf-8") as source:
                for line in source:
                    try:
                        record = json.loads(line)
                        if record.get("kind") == "cycle_usage" and record.get("status") in TERMINAL:
                            completed[record["cycle_id"]] = record
                    except (ValueError, KeyError, TypeError, AttributeError):
                        continue
        for row in state["cycles"].values():
            if row["state"] not in OPEN:
                continue
            status = "not_started" if row["state"] == "reserved" else "startup_unconfirmed"
            # Only recorded output from this exact cycle confirms an invocation.
            # An empty log, context, PID or dispatch intent is not evidence.
            for suffix in (".log", ".events.jsonl"):
                evidence = safe_path(root, "logs/" + row["cycleId"] + suffix)
                if evidence.is_file() and evidence.stat().st_size:
                    status = "interrupted"
            finished = completed.get(row["cycleId"])
            if finished and finished["status"] != "interrupted":
                status = finished["status"]
                row["startedAt"] = finished.get("started_at")
            row.update(state=status, endedAt=now(), reason="Recovered unfinished runtime attempt; no automatic replay")
            recovered.append(_projection(state, row))
    return recovered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--project", default="")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("read")
    sub.add_parser("continuation")
    create = sub.add_parser("register")
    create.add_argument("--cycle", default="")
    reserve = sub.add_parser("reserve")
    reserve.add_argument("--attempt", required=True)
    reserve.add_argument("--run-cycle", type=int, required=True)
    reserve.add_argument("--engine", default="")
    reserve.add_argument("--model", default="")
    reserve.add_argument("--shell", action="store_true")
    update = sub.add_parser("update")
    update.add_argument("--cycle", required=True)
    update.add_argument("--state", required=True)
    update.add_argument("--reason", default="")
    sub.add_parser("recover")
    unlock = sub.add_parser("recover-lock")
    unlock.add_argument("--confirm", required=True)
    move = sub.add_parser("relocate")
    move.add_argument("--id", required=True)
    args = parser.parse_args()
    try:
        if args.command == "read":
            result = get_identity(args.root, args.project)
        elif args.command == "continuation":
            print(continuation_project(args.root))
            return 0
        elif args.command == "register":
            result = register_project(args.root, args.project, args.cycle)
        elif args.command == "reserve":
            result = reserve_cycle(args.root, args.project, args.attempt, args.run_cycle, args.engine, args.model)
            if args.shell:
                # Fixed validated tokens only; callers parse fields, never eval.
                print(result["cycleId"], result["identityId"], result["productCycleNumber"], result["kind"])
                return 0
        elif args.command == "update":
            result = update_cycle(args.root, args.cycle, args.state, args.reason)
        elif args.command == "recover":
            result = recover_cycles(args.root)
        elif args.command == "relocate":
            result = relocate_identity(args.root, args.id, args.project)
        else:
            if args.confirm != "STOPPED" or os.environ.get("AUTO_COMPANY_CYCLE") == "1":
                raise ValueError("Confirm every loop, Dashboard, team and product-state writer is stopped")
            lock = safe_path(args.root, ".auto-company/product-state.lock")
            if lock.exists():
                lock.rmdir()
            with transaction(args.root):
                pass
            result = {"recovered": True}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError) as error:
        print("Product cycle state: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
