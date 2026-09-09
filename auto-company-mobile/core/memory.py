"""
Memory Manager — Per-agent long-term, episodic, semantic, procedural memory.
Uses SQLite for persistence and TF-IDF for similarity search (no external deps).
"""
import json
import math
import os
import re
import sqlite3
import time
from typing import Dict, List, Optional, Any


class MemoryManager:
    """Per-agent memory system with 4 memory types."""

    MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'longterm']

    def __init__(self, db_path: str = "state/agent_memory.db", agent_name: str = "default", embedding_provider=None):
        self.db_path = db_path
        self.agent_name = agent_name
        self.embedding_provider = embedding_provider
        self._cache: Dict[str, List[Dict]] = {}
        self._cache_ttl: Dict[str, float] = {}
        self.CACHE_TTL = 300  # 5 min cache
        self._init_db()

    def _init_db(self):
        # A bare filename (for example ``MemoryManager("memory.db")``) has
        # no directory component; SQLite should still work in the cwd.
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_name TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT,
                tags TEXT,
                importance REAL DEFAULT 0.5,
                decay_factor REAL DEFAULT 0.95,
                created_at REAL NOT NULL,
                last_accessed REAL NOT NULL,
                expires_at REAL
            )
        ''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_agent_type ON memories(agent_name, memory_type)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_expires ON memories(expires_at)')
        conn.commit()
        conn.close()

    def _vectorize(self, text: str, vocab: list | None = None) -> List[float]:
        """Simple bag-of-words vectorization over a shared vocabulary.

        When vocab is provided (cross-text comparison), each dimension
        corresponds to one word in the shared vocab — so vectors are
        comparable. When vocab is None, falls back to the text's own words.
        """
        words = re.findall(r'\b\w+\b', text.lower())
        if vocab is None:
            unique_words = list(dict.fromkeys(words))  # preserve order
            word_counts = {}
            for w in words:
                word_counts[w] = word_counts.get(w, 0) + 1
            max_count = max(word_counts.values()) if word_counts else 1
            return [word_counts.get(w, 0) / max_count for w in unique_words]
        # Shared vocab path
        word_counts = {}
        for w in words:
            word_counts[w] = word_counts.get(w, 0) + 1
        max_count = max(word_counts.values()) if word_counts else 1
        return [word_counts.get(w, 0) / max_count for w in vocab]

    def _embed(self, text: str) -> List[float]:
        if self.embedding_provider is None:
            return self._vectorize(text)
        try:
            vector = [float(value) for value in self.embedding_provider.embed(text)]
            if not vector or any(not math.isfinite(value) for value in vector):
                raise ValueError("embedding must be a finite non-empty vector")
            return vector
        except Exception:
            return self._vectorize(text)

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        """Cosine similarity between two vectors."""
        if not vec_a or not vec_b:
            return 0.0
        if len(vec_a) != len(vec_b):
            return 0.0
        dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=False))
        mag_a = math.sqrt(sum(a * a for a in vec_a))
        mag_b = math.sqrt(sum(b * b for b in vec_b))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)

    def _compute_importance(self, content: str, memory_type: str) -> float:
        """Auto-compute memory importance score."""
        if memory_type == 'procedural':
            return 0.9
        word_count = len(content.split())
        keyword_score = 0.1 if any(w in content.lower() for w in ['important', 'critical', 'error', 'failure']) else 0.0
        length_score = min(word_count / 100, 0.5)
        return min(keyword_score + length_score + 0.3, 1.0)

    def _apply_decay(self, importance: float, decay_factor: float, last_accessed: float) -> float:
        """Apply time-based memory decay."""
        time_lapsed = (time.time() - last_accessed) / 86400  # days
        decayed = importance * (decay_factor ** time_lapsed)
        return max(decayed, 0.01)

    def store(self, memory_type: str, content: str, tags: Optional[List[str]] = None,
              importance: Optional[float] = None, ttl: Optional[int] = None) -> int:
        """Store a memory."""
        if memory_type not in self.MEMORY_TYPES:
            raise ValueError(f"Invalid memory type: {memory_type}")

        if importance is None:
            importance = self._compute_importance(content, memory_type)

        embedding = json.dumps(self._embed(content))
        expires_at = time.time() + ttl if ttl else None
        tags_str = json.dumps(tags) if tags else None

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            INSERT INTO memories (agent_name, memory_type, content, embedding, tags,
                                  importance, decay_factor, created_at, last_accessed, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, 0.95, ?, ?, ?)
        ''', (self.agent_name, memory_type, content, embedding, tags_str,
              importance, time.time(), time.time(), expires_at))
        mem_id = c.lastrowid
        conn.commit()
        conn.close()

        cache_key = f"{self.agent_name}:{memory_type}"
        self._cache.pop(cache_key, None)
        return mem_id

    def retrieve(self, memory_type: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieve memories by semantic similarity."""
        cache_key = f"{self.agent_name}:{memory_type}"
        if cache_key in self._cache and time.time() - self._cache_ttl.get(cache_key, 0) < self.CACHE_TTL:
            memories = self._cache[cache_key]
        else:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('''
                SELECT * FROM memories
                WHERE agent_name = ? AND memory_type = ? AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC
            ''', (self.agent_name, memory_type, time.time()))
            memories = [dict(row) for row in c.fetchall()]
            conn.close()
            self._cache[cache_key] = memories
            self._cache_ttl[cache_key] = time.time()

    def retrieve(self, memory_type: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieve memories by semantic similarity."""
        cache_key = f"{self.agent_name}:{memory_type}"
        if cache_key in self._cache and time.time() - self._cache_ttl.get(cache_key, 0) < self.CACHE_TTL:
            memories = self._cache[cache_key]
        else:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('''
                SELECT * FROM memories
                WHERE agent_name = ? AND memory_type = ? AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC
            ''', (self.agent_name, memory_type, time.time()))
            memories = [dict(row) for row in c.fetchall()]
            conn.close()
            self._cache[cache_key] = memories
            self._cache_ttl[cache_key] = time.time()

        if not memories:
            return []

        # Build shared vocabulary from query + all memory contents for comparable vectors
        import re as _re
        all_texts = [query] + [m.get('content', '') for m in memories]
        vocab_set: dict[str, None] = {}
        for t in all_texts:
            for w in _re.findall(r'\b\w+\b', t.lower()):
                vocab_set[w] = None
        vocab = list(vocab_set)

        query_vec = self._embed(query)
        # If embedding provider is absent, use shared-vocab vectorize for comparable scores
        if self.embedding_provider is None:
            query_vec = self._vectorize(query, vocab)

        scored = []
        for mem in memories:
            raw_vec = json.loads(mem.get('embedding', '[]'))
            if self.embedding_provider is None or not raw_vec:
                mem_vec = self._vectorize(mem.get('content', ''), vocab)
            else:
                mem_vec = raw_vec
            sim = self._cosine_similarity(query_vec, mem_vec)
            decayed_imp = self._apply_decay(mem['importance'], mem['decay_factor'], mem['last_accessed'])
            final_score = sim * decayed_imp
            scored.append((mem, final_score))

        scored.sort(key=lambda x: x[1], reverse=True)
        # If all scores are zero (no overlap at all), fall back to top_k by recency
        top = scored[:top_k]
        if all(score == 0 for _, score in top):
            result = [m for m, _ in top]
        else:
            result = [m for m, score in top if score > 0.0]

        # Update last_accessed
        if result:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            now = time.time()
            for mem in result:
                c.execute('UPDATE memories SET last_accessed = ? WHERE id = ?', (now, mem['id']))
            conn.commit()
            conn.close()

        return result

    def get_episodic(self, query: str, top_k: int = 5) -> List[Dict]:
        """Get relevant episodic memories."""
        return self.retrieve('episodic', query, top_k)

    def get_semantic(self, query: str, top_k: int = 5) -> List[Dict]:
        """Get relevant semantic memories."""
        return self.retrieve('semantic', query, top_k)

    def get_procedural(self, task: str, top_k: int = 5) -> List[Dict]:
        """Get relevant procedural memories for a task."""
        return self.retrieve('procedural', task, top_k)


    def get_recent(self, memory_type: str, hours: int = 24) -> List[Dict]:
        """Get recent memories of a type."""
        cutoff = time.time() - (hours * 3600)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute('''
            SELECT * FROM memories
            WHERE agent_name = ? AND memory_type = ? AND created_at > ?
            ORDER BY created_at DESC
        ''', (self.agent_name, memory_type, cutoff))
        result = [dict(row) for row in c.fetchall()]
        conn.close()
        cache_key = f"{self.agent_name}:{memory_type}"
        self._cache[cache_key] = result
        self._cache_ttl[cache_key] = time.time()
        return result

    def forget_old(self, threshold_days: int = 30, max_memories: int = 10000):
        """Remove old memories that have decayed below threshold."""
        cutoff = time.time() - (threshold_days * 86400)
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            DELETE FROM memories
            WHERE agent_name = ? AND last_accessed < ? AND importance < 0.2
        ''', (self.agent_name, cutoff))
        deleted = c.rowcount
        conn.commit()

        # Trim to max_memories
        c.execute('''
            DELETE FROM memories
            WHERE agent_name = ? AND id NOT IN (
                SELECT id FROM memories
                WHERE agent_name = ?
                ORDER BY importance DESC, last_accessed DESC
                LIMIT ?
            )
        ''', (self.agent_name, self.agent_name, max_memories))
        conn.commit()
        conn.close()
        return deleted

    def clear(self, memory_type: Optional[str] = None):
        """Clear memories (optionally by type)."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        if memory_type:
            c.execute('DELETE FROM memories WHERE agent_name = ? AND memory_type = ?', (self.agent_name, memory_type))
        else:
            c.execute('DELETE FROM memories WHERE agent_name = ?', (self.agent_name,))
        conn.commit()
        conn.close()
        cache_key = f"{self.agent_name}:{memory_type}" if memory_type else self.agent_name
        self._cache.pop(cache_key, None)

    def get_stats(self) -> Dict[str, int]:
        """Get memory stats."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        stats = {}
        for mem_type in self.MEMORY_TYPES:
            c.execute('SELECT COUNT(*) FROM memories WHERE agent_name = ? AND memory_type = ?', (self.agent_name, mem_type))
            stats[mem_type] = c.fetchone()[0]
        c.execute('SELECT COUNT(*) FROM memories WHERE agent_name = ?', (self.agent_name,))
        stats['total'] = c.fetchone()[0]
        conn.close()
        return stats
