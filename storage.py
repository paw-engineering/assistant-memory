"""
SQLite storage layer with FTS5 full-text search for agent memories.

Each agent gets its own SQLite database with:
- memories table: id, content, tags, source, created_at, modified_at
- memories_fts: FTS5 virtual table for full-text search
- memories_emb: stored embeddings (blob) for vector similarity
- watch meta: tracks last index time per watched path
"""

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Generator, Optional


@dataclass
class MemoryItem:
    """A single memory item stored in the database."""
    id: str
    content: str
    tags: list[str] = field(default_factory=list)
    source: Optional[str] = None
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    modified_at: int = field(default_factory=lambda: int(time.time() * 1000))
    embedding: Optional[bytes] = None


class Storage:
    """
    SQLite-backed memory store with FTS5 full-text search.

    Features:
    - WAL mode for concurrent reads
    - FTS5 virtual table for BM25 search
    - Embedding storage as blob
    - Per-agent isolation (one DB per agent)
    - Citation-ready (source path stored)
    """

    SCHEMA = """
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        embedding BLOB
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        tags,
        source,
        tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_modified ON memories(modified_at);
    """

    def __init__(self, db_path: str):
        """
        Initialize storage with the given database path.

        Args:
            db_path: Path to the SQLite database file.
        """
        self.db_path = db_path
        self._local = threading.local()
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        """Get a thread-local database connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
            for stmt in self.SCHEMA.split(";"):
                stmt = stmt.strip()
                if stmt:
                    self._local.conn.execute(stmt)
            self._local.conn.commit()
        return self._local.conn

    @contextmanager
    def conn(self) -> Generator[sqlite3.Connection, None, None]:
        """Context manager for database connections."""
        conn = self._get_conn()
        try:
            yield conn
        except sqlite3.Error as e:
            conn.rollback()
            raise e

    def _init_db(self) -> None:
        """Initialize the database schema."""
        with self.conn() as conn:
            pass  # Schema applied in _get_conn

    # --- CRUD operations ---

    def add(self, item: MemoryItem) -> None:
        """
        Add a new memory item.

        Args:
            item: MemoryItem to store.
        """
        tags_json = json.dumps(item.tags)
        embedding_bytes = item.embedding
        with self.conn() as conn:
            conn.execute(
                """
                INSERT INTO memories (id, content, tags, source, created_at, modified_at, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (item.id, item.content, tags_json, item.source,
                 item.created_at, item.modified_at, embedding_bytes),
            )
            conn.execute(
                "INSERT OR REPLACE INTO memories_fts (id, content, tags, source) VALUES (?, ?, ?, ?)",
                (item.id, item.content, tags_json, item.source),
            )

    def upsert(self, item: MemoryItem) -> None:
        """
        Insert or update a memory item.

        Args:
            item: MemoryItem to upsert.
        """
        tags_json = json.dumps(item.tags)
        embedding_bytes = item.embedding
        now = int(time.time() * 1000)
        with self.conn() as conn:
            conn.execute(
                """
                INSERT INTO memories (id, content, tags, source, created_at, modified_at, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    content = excluded.content,
                    tags = excluded.tags,
                    source = excluded.source,
                    modified_at = excluded.modified_at,
                    embedding = excluded.embedding
                """,
                (item.id, item.content, tags_json, item.source,
                 item.created_at, now, embedding_bytes),
            )
            # FTS upsert
            conn.execute("DELETE FROM memories_fts WHERE id = ?", (item.id,))
            conn.execute(
                "INSERT INTO memories_fts (id, content, tags, source) VALUES (?, ?, ?, ?)",
                (item.id, item.content, tags_json, item.source),
            )

    def get(self, memory_id: str) -> Optional[MemoryItem]:
        """
        Retrieve a memory item by ID.

        Args:
            memory_id: ID of the memory item.

        Returns:
            MemoryItem if found, None otherwise.
        """
        with self.conn() as conn:
            row = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
            if not row:
                return None
            return self._row_to_item(row)

    def delete(self, memory_id: str) -> bool:
        """
        Delete a memory item by ID.

        Args:
            memory_id: ID of the memory item.

        Returns:
            True if deleted, False if not found.
        """
        with self.conn() as conn:
            # Check if the row exists before deleting
            exists = conn.execute(
                "SELECT 1 FROM memories WHERE id = ?", (memory_id,)
            ).fetchone() is not None
            if not exists:
                return False
            conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.execute("DELETE FROM memories_fts WHERE id = ?", (memory_id,))
            return True

    def clear(self) -> None:
        """Delete all memory items."""
        with self.conn() as conn:
            conn.execute("DELETE FROM memories")
            conn.execute("DELETE FROM memories_fts")

    # --- Search ---

    def search_fts(
        self, query: str, limit: int = 5
    ) -> list[tuple[MemoryItem, float]]:
        """
        Full-text search using FTS5 BM25.

        Args:
            query: Search query string.
            limit: Maximum number of results.

        Returns:
            List of (MemoryItem, bm25_score) tuples, best match first.
        """
        with self.conn() as conn:
            rows = conn.execute(
                """
                SELECT m.*, bm25(memories_fts) as score
                FROM memories_fts fts
                JOIN memories m ON m.id = fts.id
                WHERE memories_fts MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (query, limit),
            ).fetchall()
            return [(self._row_to_item(row), float(row["score"])) for row in rows]

    def get_all(self, limit: int = 1000) -> list[MemoryItem]:
        """
        Get all memory items, newest first.

        Args:
            limit: Maximum number of items to return.

        Returns:
            List of MemoryItems.
        """
        with self.conn() as conn:
            rows = conn.execute(
                "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._row_to_item(row) for row in rows]

    def get_all_for_indexing(self) -> list[MemoryItem]:
        """Get all memories that have embeddings for vector index."""
        with self.conn() as conn:
            rows = conn.execute(
                "SELECT * FROM memories WHERE embedding IS NOT NULL"
            ).fetchall()
            return [self._row_to_item(row) for row in rows]

    # --- Embeddings ---

    def update_embedding(self, memory_id: str, embedding: bytes) -> None:
        """
        Store/update the embedding blob for a memory item.

        Args:
            memory_id: ID of the memory item.
            embedding: Raw bytes of the embedding vector.
        """
        with self.conn() as conn:
            conn.execute(
                "UPDATE memories SET embedding = ? WHERE id = ?",
                (embedding, memory_id),
            )

    def get_embedding(self, memory_id: str) -> Optional[bytes]:
        """
        Get the embedding blob for a memory item.

        Args:
            memory_id: ID of the memory item.

        Returns:
            Embedding bytes or None.
        """
        with self.conn() as conn:
            row = conn.execute(
                "SELECT embedding FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
            return row["embedding"] if row else None

    # --- Metadata ---

    def get_meta(self, key: str) -> Optional[str]:
        """Get a metadata value."""
        with self.conn() as conn:
            row = conn.execute(
                "SELECT value FROM meta WHERE key = ?", (key,)
            ).fetchone()
            return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        """Set a metadata value."""
        with self.conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                (key, value),
            )

    # --- Stats ---

    @property
    def count(self) -> int:
        """Total number of memory items."""
        with self.conn() as conn:
            row = conn.execute("SELECT COUNT(*) as c FROM memories").fetchone()
            return row["c"]

    @property
    def indexed_count(self) -> int:
        """Number of memory items with embeddings."""
        with self.conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL"
            ).fetchone()
            return row["c"]

    def last_index_time(self) -> Optional[int]:
        """Get the last index timestamp."""
        val = self.get_meta("last_index_time")
        return int(val) if val else None

    # --- Helpers ---

    def _row_to_item(self, row: sqlite3.Row) -> MemoryItem:
        """Convert a database row to a MemoryItem."""
        tags = json.loads(row["tags"]) if row["tags"] else []
        return MemoryItem(
            id=row["id"],
            content=row["content"],
            tags=tags,
            source=row["source"],
            created_at=row["created_at"],
            modified_at=row["modified_at"],
            embedding=row["embedding"],
        )

    def close(self) -> None:
        """Close the database connection."""
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None

    def checkpoint(self) -> None:
        """Run a WAL checkpoint to consolidate writes."""
        with self.conn() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
