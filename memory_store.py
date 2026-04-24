"""
In-memory vector store for agent memories.

Stores memory chunks with their embeddings, supports backup/restore to JSON,
and provides cosine similarity search.
"""

import json
import shutil
import time
import os
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime
import math


@dataclass
class MemoryChunk:
    """A single memory chunk with embedding."""
    id: str
    file_path: str
    chunk_index: int
    content: str
    embedding: list[float]
    created_at: int  # Unix timestamp ms
    modified_at: int  # Unix timestamp ms

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryChunk":
        return cls(**d)


class VectorStore:
    """
    In-memory vector store for memory chunks.

    Provides:
    - Add, update, delete chunks
    - Cosine similarity search
    - Backup/restore to JSON
    - File-level chunk grouping
    """

    def __init__(self, data_dir: str, backup_interval: int = 300):
        """
        Initialize the vector store.

        Args:
            data_dir: Directory to store data files (store.json, meta.json).
            backup_interval: Interval in seconds for automatic backups (default: 300 = 5 min).
        """
        self.data_dir = data_dir
        self.backup_interval = backup_interval
        self.store_path = os.path.join(data_dir, "store.json")
        self.meta_path = os.path.join(data_dir, "meta.json")
        self.backup_dir = os.path.join(data_dir, "backups")

        self._chunks: dict[str, MemoryChunk] = {}
        self._meta: dict[str, str] = {}
        self._file_chunks: dict[str, set[str]] = {}  # file_path -> set of chunk ids

        self._load()
        os.makedirs(self.backup_dir, exist_ok=True)
        self.save()  # Ensure store.json exists on disk (initial empty state)

    def _load(self) -> None:
        """Load store and metadata from disk."""
        if os.path.exists(self.store_path):
            try:
                with open(self.store_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for chunk_data in data.get("chunks", []):
                    chunk = MemoryChunk.from_dict(chunk_data)
                    self._chunks[chunk.id] = chunk
                    if chunk.file_path not in self._file_chunks:
                        self._file_chunks[chunk.file_path] = set()
                    self._file_chunks[chunk.file_path].add(chunk.id)
            except Exception as e:
                print(f"[store] Failed to load store: {e}")

        if os.path.exists(self.meta_path):
            try:
                with open(self.meta_path, "r", encoding="utf-8") as f:
                    self._meta = json.load(f)
            except Exception as e:
                print(f"[store] Failed to load meta: {e}")

    def save(self) -> None:
        """Save store and metadata to disk."""
        os.makedirs(self.data_dir, exist_ok=True)

        # Save chunks
        chunks_data = [chunk.to_dict() for chunk in self._chunks.values()]
        with open(self.store_path, "w", encoding="utf-8") as f:
            json.dump({"chunks": chunks_data, "saved_at": time.time()}, f, indent=2)

        # Save meta
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(self._meta, f, indent=2)

    def backup(self) -> str:
        """
        Create a timestamped backup of the store.

        Returns:
            Path to the backup file.
        """
        os.makedirs(self.backup_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = os.path.join(self.backup_dir, f"store_{timestamp}.json")
        shutil.copy2(self.store_path, backup_path)

        # Clean old backups (keep last 10)
        self._clean_old_backups(keep=10)

        print(f"[store] Backup created: {backup_path}")
        return backup_path

    def _clean_old_backups(self, keep: int = 10) -> None:
        """Remove old backups, keeping the most recent N."""
        if not os.path.exists(self.backup_dir):
            return
        backups = sorted(
            [f for f in os.listdir(self.backup_dir) if f.startswith("store_")],
            reverse=True,
        )
        for old_backup in backups[keep:]:
            try:
                os.remove(os.path.join(self.backup_dir, old_backup))
            except Exception:
                pass

    def restore(self, backup_path: str) -> bool:
        """
        Restore store from a backup file.

        Args:
            backup_path: Path to the backup file.

        Returns:
            True if restore succeeded, False otherwise.
        """
        try:
            with open(backup_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self._chunks.clear()
            self._file_chunks.clear()

            for chunk_data in data.get("chunks", []):
                chunk = MemoryChunk.from_dict(chunk_data)
                self._chunks[chunk.id] = chunk
                if chunk.file_path not in self._file_chunks:
                    self._file_chunks[chunk.file_path] = set()
                self._file_chunks[chunk.file_path].add(chunk.id)

            self.save()
            print(f"[store] Restored from: {backup_path}")
            return True
        except Exception as e:
            print(f"[store] Restore failed: {e}")
            return False

    def restore_latest(self) -> bool:
        """
        Restore from the most recent backup.

        Returns:
            True if restore succeeded, False otherwise.
        """
        if not os.path.exists(self.backup_dir):
            return False
        backups = sorted(
            [f for f in os.listdir(self.backup_dir) if f.startswith("store_")],
            reverse=True,
        )
        if not backups:
            return False
        return self.restore(os.path.join(self.backup_dir, backups[0]))

    # --- Chunk operations ---

    def add_chunk(self, chunk: MemoryChunk) -> None:
        """Add a new memory chunk."""
        self._chunks[chunk.id] = chunk
        if chunk.file_path not in self._file_chunks:
            self._file_chunks[chunk.file_path] = set()
        self._file_chunks[chunk.file_path].add(chunk.id)

    def upsert_chunk(self, chunk: MemoryChunk) -> None:
        """Insert or update a memory chunk."""
        self._chunks[chunk.id] = chunk
        if chunk.file_path not in self._file_chunks:
            self._file_chunks[chunk.file_path] = set()
        self._file_chunks[chunk.file_path].add(chunk.id)

    def delete_chunk(self, chunk_id: str) -> None:
        """Delete a chunk by ID."""
        if chunk_id in self._chunks:
            chunk = self._chunks.pop(chunk_id)
            if chunk.file_path in self._file_chunks:
                self._file_chunks[chunk.file_path].discard(chunk_id)

    def delete_chunks_for_file(self, file_path: str) -> None:
        """Delete all chunks belonging to a file."""
        if file_path in self._file_chunks:
            for chunk_id in list(self._file_chunks[file_path]):
                self._chunks.pop(chunk_id, None)
            del self._file_chunks[file_path]

    def clear(self) -> None:
        """Clear all chunks and metadata."""
        self._chunks.clear()
        self._file_chunks.clear()

    # --- Metadata ---

    def get_meta(self, key: str) -> Optional[str]:
        """Get a metadata value."""
        return self._meta.get(key)

    def set_meta(self, key: str, value: str) -> None:
        """Set a metadata value."""
        self._meta[key] = value

    # --- Search ---

    def search_by_vector(
        self, query_embedding: list[float], top_k: int = 5
    ) -> list[MemoryChunk]:
        """
        Search for the most similar chunks using cosine similarity.

        Args:
            query_embedding: Query vector.
            top_k: Number of results to return.

        Returns:
            List of matching chunks, sorted by similarity (best first).
        """
        if not self._chunks:
            return []

        query_norm = math.sqrt(sum(v * v for v in query_embedding))
        if query_norm == 0:
            return []

        results: list[tuple[float, MemoryChunk]] = []

        for chunk in self._chunks.values():
            # Cosine similarity
            dot_product = sum(q * v for q, v in zip(query_embedding, chunk.embedding))
            chunk_norm = math.sqrt(sum(v * v for v in chunk.embedding))
            if chunk_norm == 0:
                continue
            similarity = dot_product / (query_norm * chunk_norm)
            results.append((similarity, chunk))

        # Sort by similarity descending
        results.sort(key=lambda x: x[0], reverse=True)
        return [chunk for _, chunk in results[:top_k]]

    def search(self, query: str, embed_fn, top_k: int = 5) -> list[MemoryChunk]:
        """
        Search by generating embedding for query text.

        Args:
            query: Query text.
            embed_fn: Function that takes text and returns embedding.
            top_k: Number of results to return.

        Returns:
            List of matching chunks.
        """
        embedding = embed_fn(query)
        if embedding is None:
            return []
        return self.search_by_vector(embedding, top_k)

    # --- Stats ---

    @property
    def chunk_count(self) -> int:
        """Total number of chunks."""
        return len(self._chunks)

    @property
    def file_count(self) -> int:
        """Number of unique files."""
        return len(self._file_chunks)

    def get_chunk_count(self) -> int:
        return self.chunk_count

    def get_file_count(self) -> int:
        return self.file_count

    def close(self) -> None:
        """Save data and prepare for shutdown."""
        self.save()
