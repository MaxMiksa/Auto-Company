#!/usr/bin/env python3
"""
Auto Company — Persistent Vector Memory Vault
==============================================

A lightweight, dependency-free long-term memory layer that RUNS ALONGSIDE the
existing `memories/consensus.md` baton (the single-file relay). It adds
semantic retrieval on top of the full history that consensus.md collapses away,
so agents can recall relevant past decisions, project states, and docs without
loading everything into the prompt.

WHY keep consensus.md?
  consensus.md stays the authoritative *running state + next-action baton* that
  auto-loop.sh reads/writes every cycle. The vault is a *supplemental read-only
  index* built from the changelog of consensus snapshots + per-role docs.

VECTOR DESIGN (zero external deps — "boring technology first"):
  - Each memory chunk is tokenized into character n-grams (covers ENG+中文)
  - Term frequency vectors are stored as {term: weight}
  - Retrieval = cosine similarity (sparse dot product over a shared vocabulary)
  - No numpy / no embedding model / no network required. Pure stdlib.

To swap in a real vector DB (ChromaDB, etc.) or a model embedding:
  - Replace `_embed_chunk(text)` to return a numeric vector
  - Replace backend read/write in `vault_read` / `vault_write`
  JSON format below is kept backend-agnostic (`embeddings` can be dicts of
  sparse terms OR dense lists; both are handled on read).

Usage:
  python3 memory_vault.py index [--consensus FILE] [--docs-dir DIR] [--vault DIR]
      Scan consensus + docs, chunk, embed, upsert into vault.
  python3 memory_vault.py search QUERY [--top-k N] [--vault DIR] [--min-score F]
      Semantic search over the vault; prints markdown snippet block.
  python3 memory_vault.py status [--vault DIR]
      Print vault stats (chunk count, memory size, distinct terms).
  python3 memory_vault.py clear [--vault DIR]
      Wipe the vault (destructive; asks unless --force).
"""

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------- config ----

DEFAULT_VAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "..", "memories", "vault")
INDEX_FILE = "index.json"
DOCS_DEFAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "..", "docs")

# Chunking: target ~N tokens worth of text per memory unit (split on blank lines).
CHUNK_MIN_CHARS = 120
CHUNK_MAX_CHARS = 1400
TOP_K_DEFAULT = 5
MIN_SCORE_DEFAULT = 0.05

# Character n-gram feature extraction (covers English + CJK without word-seg).
NGRAM_MIN = 2
NGRAM_MAX = 3
STOP_CHARS = set(" \t\r\n\"'`.,;:!?()[]{}<>-_=+|/\\@#$%^&*~·。，；：！？、（）《》【】—…•")
CJK_RE = re.compile(r'[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]')


# ------------------------------------------------------------- features -----

def _ngrams(text: str) -> dict:
    """Return {term: normalized-weight} for overlapping char n-grams."""
    # Normalize whitespace runs to single space so chunk boundaries are stable.
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = text.strip()
    if not text:
        return {}
    low = text.lower()
    counts: dict = {}
    n_chars = len(low)
    for n in range(NGRAM_MIN, min(NGRAM_MAX, n_chars) + 1):
        for i in range(n_chars - n + 1):
            gram = low[i:i + n]
            if any(c in STOP_CHARS for c in gram):
                continue
            # Keep CJK grams, else require at least one alpha char.
            if not CJK_RE.search(gram) and not any(c.isalpha() for c in gram):
                continue
            counts[gram] = counts.get(gram, 0) + 1
    # Normalize to term frequency (raw counts up to sqrt): dampens long doc bias.
    tf = {g: 1.0 + math.log(c) for g, c in counts.items()}
    # L2 normalize.
    norm = math.sqrt(sum(v * v for v in tf.values())) or 1.0
    return {g: v / norm for g, v in tf.items()}


def _embed_chunk(text: str):
    """Sparse embedding. Replace with a real embedding call to upgrade."""
    return _ngrams(text)


# --------------------------------------------------------------- vault io ----

def _vault_index_path(vault_dir: str) -> str:
    return os.path.join(vault_dir, INDEX_FILE)


def vault_read(vault_dir: str) -> dict:
    path = _vault_index_path(vault_dir)
    if not os.path.exists(path):
        return {"version": 1, "chunks": []}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        # Corrupt index -> start fresh rather than crash a cycle.
        return {"version": 1, "chunks": []}


def vault_write(vault_dir: str, index: dict) -> None:
    os.makedirs(vault_dir, exist_ok=True)
    tmp = _vault_index_path(vault_dir) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False)
    os.replace(tmp, _vault_index_path(vault_dir))


# ----------------------------------------------------------- chunking -------

def _iter_markdown_blocks(text: str):
    """Split markdown into semantically-meaningful blocks on blank lines."""
    blocks, cur = [], []
    for line in text.splitlines():
        line = line.rstrip()
        if not line.strip() and cur:
            blocks.append("\n".join(cur))
            cur = []
        else:
            cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    # Merge tiny blocks and re-split oversized blocks.
    merged: list = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        if merged and len(merged[-1]) < CHUNK_MIN_CHARS and \
                len(merged[-1]) + len(b) <= CHUNK_MAX_CHARS:
            merged[-1] = merged[-1] + "\n\n" + b
        else:
            merged.append(b)
    result: list = []
    for b in merged:
        if len(b) <= CHUNK_MAX_CHARS:
            result.append(b)
        else:
            # Hard split oversized block on nearest sentence boundary.
            start, b_len = 0, len(b)
            while start < b_len:
                end = min(start + CHUNK_MAX_CHARS, b_len)
                if end < b_len:
                    cut = b.rfind("。", start, end)
                    if cut <= start + CHUNK_MIN_CHARS:
                        cut = b.rfind("\n", start, end)
                    if cut <= start + CHUNK_MIN_CHARS:
                        cut = end
                    end = cut
                result.append(b[start:end].strip())
                start = end
    return [r for r in result if len(r) >= CHUNK_MIN_CHARS // 2]


def _generate_chunks(consensus_text: str, docs_map: dict):
    """Yield (source, kind, text) tuples. docs_map: {relpath: text}."""
    if consensus_text.strip():
        yield "consensus.md", "consensus", consensus_text
    for rel, text in docs_map.items():
        if not text.strip():
            continue
        for block in _iter_markdown_blocks(text):
            yield rel, "docs", block


# -------------------------------------------------------------- ingest -------

def cmd_index(args) -> int:
    consensus_text = ""
    if args.consensus and os.path.exists(args.consensus):
        with open(args.consensus, "r", encoding="utf-8") as fh:
            consensus_text = fh.read()

    docs_map = {}
    docs_dir = args.docs_dir or DOCS_DEFAULT
    if os.path.isdir(docs_dir):
        for root, _dirs, files in os.walk(docs_dir):
            for fn in sorted(files):
                if not fn.endswith((".md", ".txt")):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, docs_dir)
                try:
                    with open(full, "r", encoding="utf-8") as fh:
                        docs_map[os.path.join("docs", rel)] = fh.read()
                except (OSError, UnicodeDecodeError):
                    continue

    vault = vault_read(args.vault)
    existing = {c["id"] for c in vault["chunks"]}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    added = 0
    new_chunks = []
    for source, kind, text in _generate_chunks(consensus_text, docs_map):
        cid = _stable_id(source, text)
        if cid in existing:
            continue
        emb = _embed_chunk(text)
        if not emb:
            continue
        new_chunks.append({
            "id": cid,
            "source": source,
            "kind": kind,
            "text": text,
            "page": now,
            "embeddings": emb,
        })
        added += 1

    # Cap vault growth: keep the most recent N chunks (append new, drop oldest).
    max_chunks = int(args.max_chunks or 5000)
    vault["chunks"].extend(new_chunks)
    if len(vault["chunks"]) > max_chunks:
        vault["chunks"] = vault["chunks"][-max_chunks:]

    vault["last_indexed"] = now
    vault["count"] = len(vault["chunks"])
    vault_write(args.vault, vault)

    print(f"vault: +{added} added, {len(vault['chunks'])} total chunks "
          f"({_size_mb(args.vault)} MB), sources: {len(set(c['source'] for c in new_chunks))}")
    return 0


# ------------------------------------------------------------ retrieval ------

def _stable_id(source: str, text: str) -> str:
    import hashlib
    return hashlib.sha1((source + "\x00" + text).encode("utf-8")).hexdigest()[:16]


def _cosine(a: dict, b: dict) -> float:
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    dot = 0.0
    for term, w in a.items():
        wb = b.get(term)
        if wb:
            dot += w * wb
    return dot  # both already L2-normalized


def _normalize_embedding(emb):
    """Accept sparse dict {term: weight} OR dense list of floats."""
    if isinstance(emb, list):
        norm = math.sqrt(sum(x * x for x in emb)) or 1.0
        return {f"d{i}": v / norm for i, v in enumerate(emb)}
    if isinstance(emb, dict):
        return emb
    return {}


def cmd_search(args) -> int:
    vault = vault_read(args.vault)
    chunks = vault.get("chunks", [])
    query_emb = _ngrams(args.query)
    if not query_emb or not chunks:
        print("_no_vault_hit_")
        return 0

    top_k = int(args.top_k or TOP_K_DEFAULT)
    min_score = float(args.min_score or MIN_SCORE_DEFAULT)

    scored = []
    for c in chunks:
        emb = _normalize_embedding(c.get("embeddings", {}))
        if not emb:
            continue
        s = _cosine(query_emb, emb)
        if s >= min_score:
            scored.append((s, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    scored = scored[:top_k]

    if not scored:
        print("_no_vault_hit_")
        return 0

    # Emit a markdown snippet block that auto-loop.sh injects into the prompt.
    print(f"**[Retrieved {len(scored)} relevant memory block(s) from vault]**")
    for i, (score, c) in enumerate(scored, 1):
        text = c["text"].strip().replace("\n", " ")
        text = text if len(text) <= 500 else text[:497] + "..."
        print(f"---\n[{i}] score={score:.3f} src=`{c['source']}` (idx {c['id']})\n{text}")
    return 0


# ------------------------------------------------------------- utilities -----

def _size_mb(vault_dir: str) -> float:
    path = _vault_index_path(vault_dir)
    try:
        return round(os.path.getsize(path) / (1024 * 1024), 2)
    except OSError:
        return 0.0


def cmd_status(args) -> int:
    vault = vault_read(args.vault)
    chunks = vault.get("chunks", [])
    terms = set()
    for c in chunks:
        emb = _normalize_embedding(c.get("embeddings", {}))
        terms.update(emb.keys())
    print(f"vault_dir: {os.path.abspath(args.vault)}")
    print(f"chunks:    {len(chunks)}")
    print(f"distinct_terms: {len(terms)}")
    print(f"last_indexed:   {vault.get('last_indexed', 'never')}")
    print(f"size_mb:   {_size_mb(args.vault)}")
    return 0


def cmd_clear(args) -> int:
    path = _vault_index_path(args.vault)
    if not args.force:
        sys.stderr.write("Refusing to clear without --force.\n")
        return 1
    if os.path.exists(path):
        os.remove(path)
    print(f"vault cleared: {os.path.abspath(path)}")
    return 0


# ------------------------------------------------------------------ main -----

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Auto Company vector memory vault")
    ap.add_argument("--vault", default=DEFAULT_VAULT)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_index = sub.add_parser("index", help="Scan consensus + docs into vault")
    p_index.add_argument("--consensus", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "memories", "consensus.md"))
    p_index.add_argument("--docs-dir", default=DOCS_DEFAULT)
    p_index.add_argument("--max-chunks", default="5000")
    p_index.set_defaults(func=cmd_index)

    p_search = sub.add_parser("search", help="Semantic search over the vault")
    p_search.add_argument("query")
    p_search.add_argument("--top-k", default=str(TOP_K_DEFAULT))
    p_search.add_argument("--min-score", default=str(MIN_SCORE_DEFAULT))
    p_search.set_defaults(func=cmd_search)

    p_status = sub.add_parser("status")
    p_status.set_defaults(func=cmd_status)

    p_clear = sub.add_parser("clear")
    p_clear.add_argument("--force", action="store_true")
    p_clear.set_defaults(func=cmd_clear)

    args = ap.parse_args(argv)
    args.vault = os.path.abspath(args.vault)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
