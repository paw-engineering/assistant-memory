"""
Index management for memory embeddings.

Two strategies combined:
1. **On-change**: Index updates immediately when memories change (add/update/delete)
2. **Periodic fallback**: Periodic scan ensures index stays consistent

The index is stored as part of the SQLite DB (embedding blobs on each memory row).
We track index state via the `meta` table.

For vector similarity, we load embeddings into an in-memory list on startup.
This is sufficient for per-agent scale (thousands of items, not millions).
"""

import math
import struct
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from config import MemoryConfig
from embedder import Embedder, EmbedderError
from storage import MemoryItem, Storage


@dataclass
class IndexStats:
    """Statistics about the current index state."""
    total_items: int = 0
    indexed_items: int = 0
    last_index_time: Optional[int] = None
    index_age_seconds: Optional[float] = None


class Indexer:
    """
    Manages the embedding index for agent memories.

    Combines immediate updates (on-change) with periodic consistency checks.
    Uses cosine similarity for vector search.
    """

    def __init__(
        self,
        storage: Storage,
        embedder: Embedder,
        config: MemoryConfig,
    ):
        """
        Initialize the indexer.

        Args:
            storage: Storage instance for reading/writing memories.
            embedder: Embedder for generating embeddings.
            config: MemoryConfig with index settings.
        """
        self.storage = storage
        self.embedder = embedder
        self.config = config

        self._index: list[bytes] = []  # embeddings in creation order
        self._id_map: list[str] = []  # index position → memory id
        self._id_to_idx: dict[str, int] = {}  # memory id → index position
        self._lock = threading.RLock()

        self._rebuild_index()
        self._start_periodic_update()

    # --- Public API ---

    def index_memory(self, item: MemoryItem, regenerate: bool = True) -> bool:
        """
        Index a single memory item (generate + store embedding).

        Args:
            item: MemoryItem to index.
            regenerate: If True, always regenerate embedding. If False, skip if exists.

        Returns:
            True if indexed successfully, False otherwise.
        """
        if not regenerate and item.embedding:
            return True

        try:
            embedding = self.embedder.embed(item.content)
            if embedding is None:
                return False

            item.embedding = embedding
            self.storage.upsert(item)
            self._add_to_index(item)
            self._update_index_time()
            return True

        except EmbedderError:
            return False

    def remove_from_index(self, memory_id: str) -> None:
        """
        Remove a memory from the vector index.

        Args:
            memory_id: ID of the memory to remove.
        """
        with self._lock:
            idx = self._id_to_idx.get(memory_id)
            if idx is not None:
                # Swap with last element for O(1) removal
                last_id = self._id_map[-1]
                self._index[idx] = self._index[-1]
                self._id_map[idx] = last_id
                self._id_to_idx[last_id] = idx
                self._index.pop()
                self._id_map.pop()
                del self._id_to_idx[memory_id]

    def search(
        self,
        query_embedding: bytes,
        k: int = 5,
        min_score: float = 0.0,
    ) -> list[tuple[str, float]]:
        """
        Find the k most similar memories to the query embedding.

        Args:
            query_embedding: Raw bytes of query embedding.
            k: Number of results to return.
            min_score: Minimum cosine similarity threshold.

        Returns:
            List of (memory_id, cosine_score) tuples, best match first.
        """
        with self._lock:
            if not self._index:
                return []

            query_vec = Embedder.unpack_floats(
                query_embedding, self.embedder.dimension
            )
            query_norm = self._norm(query_vec)

            if query_norm == 0:
                return []

            scores: list[tuple[int, float]] = []
            for i, emb_bytes in enumerate(self._index):
                vec = Embedder.unpack_floats(emb_bytes, self.embedder.dimension)
                dot = sum(a * b for a, b in zip(query_vec, vec))
                norm = self._norm(vec)
                if norm > 0:
                    cosine = dot / (query_norm * norm)
                    if cosine >= min_score:
                        scores.append((i, cosine))

            # Sort by cosine similarity descending
            scores.sort(key=lambda x: x[1], reverse=True)
            return [(self._id_map[i], score) for i, score in scores[:k]]

    def embed_and_search(
        self, query_text: str, k: int = 5, min_score: float = 0.0
    ) -> list[tuple[str, float]]:
        """
        Embed a query and search for similar memories.

        Args:
            query_text: Text to search for.
            k: Number of results.
            min_score: Minimum similarity threshold.

        Returns:
            List of (memory_id, cosine_score) tuples.
        """
        try:
            query_emb = self.embedder.embed(query_text)
            if query_emb is None:
                return []
            return self.search(query_emb, k, min_score)
        except EmbedderError:
            return []

    def stats(self) -> IndexStats:
        """Get current index statistics."""
        last_time = self.storage.last_index_time()
        now_ms = int(time.time() * 1000)
        age = (now_ms - last_time) / 1000 if last_time else None
        return IndexStats(
            total_items=self.storage.count,
            indexed_items=len(self._index),
            last_index_time=last_time,
            index_age_seconds=age,
        )

    def rebuild_index(self) -> None:
        """Full rebuild of the vector index from all stored memories."""
        self._rebuild_index()

    def shutdown(self) -> None:
        """Stop the periodic update thread."""
        self._running = False
        if self._timer:
            self._timer.cancel()

    # --- Internal ---

    def _rebuild_index(self) -> None:
        """Rebuild the in-memory index from all stored memories."""
        with self._lock:
            self._index = []
            self._id_map = []
            self._id_to_idx = {}

            items = self.storage.get_all_for_indexing()
            for item in items:
                self._add_to_index(item)

    def _add_to_index(self, item: MemoryItem) -> None:
        """Add a memory to the in-memory index."""
        with self._lock:
            if item.embedding is None:
                return
            # Check if already indexed
            if item.id in self._id_to_idx:
                return
            idx = len(self._index)
            self._index.append(item.embedding)
            self._id_map.append(item.id)
            self._id_to_idx[item.id] = idx

    def _update_index_time(self) -> None:
        """Record the current time as the last index update."""
        now = int(time.time() * 1000)
        self.storage.set_meta("last_index_time", str(now))

    def _start_periodic_update(self) -> None:
        """Start the periodic index rebuild timer."""
        self._running = True
        self._timer = None
        self._schedule_periodic_update()

    def _schedule_periodic_update(self) -> None:
        """Schedule the next periodic index check."""
        if not self._running:
            return
        interval_sec = self.config.index_rebuild_interval
        self._timer = threading.Timer(interval_sec, self._periodic_update)
        self._timer.daemon = True
        self._timer.start()

    def _periodic_update(self) -> None:
        """Periodic rebuild to catch any drift or missing embeddings."""
        if not self._running:
            return
        try:
            # Check for items without embeddings
            all_items = self.storage.get_all()
            missing = [item for item in all_items if item.embedding is None]
            if missing:
                # Embed missing items
                for item in missing:
                    try:
                        emb = self.embedder.embed(item.content)
                        if emb:
                            item.embedding = emb
                            self.storage.upsert(item)
                            self._add_to_index(item)
                    except EmbedderError:
                        pass
            self._update_index_time()
        except Exception:
            pass
        finally:
            self._schedule_periodic_update()

    @staticmethod
    def _norm(vec: list[float]) -> float:
        """Compute L2 norm of a vector."""
        return math.sqrt(sum(x * x for x in vec))