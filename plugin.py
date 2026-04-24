"""
DWG Assistant Memory Plugin — main module.

Per-agent memory system with:
- SQLite + FTS5 full-text search
- LM Studio embeddings (text-embedding-qwen3-embedding-4b)
- Periodic backup (5-min interval)
- Non-blocking version logging (Option B base image)

Integrates as a module for each DWG Assistant container.
Run as a standalone service or import as a library.
"""

import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

# Configure plugin logger
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

from config import MemoryConfig, load_config
from storage import MemoryItem, Storage
from embedder import Embedder, EmbedderError
from indexer import Indexer
from backup import BackupManager, BackupScheduler
from version import PLUGIN_VERSION, check_version, version_status


class AgentMemory:
    """
    Main plugin class for per-agent memory management.

    Exposes:
    - search(query, limit?)
    - add_memory(content, tags?, source?)
    - update_memory(memory_id, content)
    - delete_memory(memory_id)
    - health()
    - status()
    - version_check()
    """

    def __init__(self, config: Optional[MemoryConfig] = None):
        """
        Initialize the memory plugin for an agent.

        Args:
            config: MemoryConfig instance. If None, loads from environment/config file.
        """
        self.config = config or load_config()
        self._setup_directories()
        self._init_storage()
        self._init_embedder()
        self._init_indexer()
        self._init_backup()
        self._log_version()

    def _setup_directories(self) -> None:
        """Create necessary data directories."""
        os.makedirs(self.config.data_dir, exist_ok=True)
        os.makedirs(self.config.backup_dir, exist_ok=True)

    def _init_storage(self) -> None:
        """Initialize the storage layer."""
        self.storage = Storage(self.config.db_path)

    def _init_embedder(self) -> None:
        """Initialize the embedder."""
        self.embedder = Embedder(self.config)

    def _init_indexer(self) -> None:
        """Initialize the indexer."""
        self.indexer = Indexer(self.storage, self.embedder, self.config)

    def _init_backup(self) -> None:
        """Initialize the backup system."""
        self.backup_manager = BackupManager(
            self.config.db_path,
            self.config.backup_dir,
            self.config.max_backups,
        )
        self.backup_scheduler = BackupScheduler(
            self.backup_manager,
            self.config.backup_interval,
        )
        self.backup_scheduler.start()

    # --- Memory operations ---

    def add_memory(
        self,
        content: str,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
    ) -> str:
        """
        Add a new memory item.

        Args:
            content: The memory content (text).
            tags: Optional list of tag strings.
            source: Optional source path/URI.

        Returns:
            The memory ID of the created item.
        """
        memory_id = str(uuid.uuid4())
        item = MemoryItem(
            id=memory_id,
            content=content,
            tags=tags or [],
            source=source,
        )
        self.storage.add(item)
        # Index asynchronously to avoid blocking
        threading.Thread(target=self.indexer.index_memory, args=(item,)).start()
        return memory_id

    def update_memory(
        self,
        memory_id: str,
        content: Optional[str] = None,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
    ) -> bool:
        """
        Update an existing memory item.

        Args:
            memory_id: ID of the memory to update.
            content: New content (if provided).
            tags: New tags (if provided).
            source: New source (if provided).

        Returns:
            True if updated, False if not found.
        """
        existing = self.storage.get(memory_id)
        if not existing:
            return False

        if content is not None:
            existing.content = content
        if tags is not None:
            existing.tags = tags
        if source is not None:
            existing.source = source
        existing.modified_at = int(time.time() * 1000)
        existing.embedding = None  # Will be regenerated

        self.storage.upsert(existing)
        threading.Thread(target=self.indexer.index_memory, args=(existing,)).start()
        return True

    def delete_memory(self, memory_id: str) -> bool:
        """
        Delete a memory item.

        Args:
            memory_id: ID of the memory to delete.

        Returns:
            True if deleted, False if not found.
        """
        self.indexer.remove_from_index(memory_id)
        return self.storage.delete(memory_id)

    def get_memory(self, memory_id: str) -> Optional[dict]:
        """
        Get a memory item by ID.

        Args:
            memory_id: ID of the memory.

        Returns:
            Dict representation or None.
        """
        item = self.storage.get(memory_id)
        return self._item_to_dict(item) if item else None

    def list_memories(self, limit: int = 100) -> list[dict]:
        """
        List all memories, newest first.

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of dict representations.
        """
        items = self.storage.get_all(limit)
        return [self._item_to_dict(item) for item in items]

    # --- Search ---

    def search(
        self,
        query: str,
        limit: int = 5,
        hybrid: bool = True,
    ) -> dict:
        """
        Search memories using hybrid BM25 + vector similarity.

        Args:
            query: Search query string.
            limit: Maximum number of results.
            hybrid: If True, combine FTS and vector. If False, FTS only.

        Returns:
            Dict with results, scores, and metadata.
        """
        start_ms = int(time.time() * 1000)

        # FTS results
        fts_results = self.storage.search_fts(query, limit * 2)
        fts_map = {item.id: score for item, score in fts_results}

        # Vector results (if hybrid and embedder available)
        vector_ids = []
        if hybrid:
            try:
                vector_results = self.indexer.embed_and_search(query, limit * 2)
                vector_ids = [mem_id for mem_id, _ in vector_results]
            except EmbedderError:
                pass

        # Combine and rank
        seen = set()
        combined = []

        # Interleave vector results first (higher weight)
        if hybrid:
            for mem_id in vector_ids:
                if mem_id in fts_map and mem_id not in seen:
                    seen.add(mem_id)
                    item = self.storage.get(mem_id)
                    if item:
                        combined.append((item, fts_map[mem_id], "hybrid"))

        # Add remaining FTS results
        for item, score in fts_results:
            if item.id not in seen:
                seen.add(item.id)
                combined.append((item, score, "fts"))

        # Take top k and format response
        results = []
        for item, score, match_type in combined[:limit]:
            results.append({
                "id": item.id,
                "content": item.content,
                "tags": item.tags,
                "source": item.source,
                "created_at": item.created_at,
                "score": score,
                "match_type": match_type,
            })

        search_ms = int(time.time() * 1000) - start_ms
        return {
            "results": results,
            "meta": {
                "total": len(combined),
                "search_ms": search_ms,
                "query": query,
            },
        }

    # --- Health and status ---

    def health(self) -> dict:
        """
        Check overall system health.

        Returns:
            Dict with status indicators for each subsystem.
        """
        db_ok = True
        try:
            _ = self.storage.count
        except Exception:
            db_ok = False

        embedder_status = self.embedder.health_check()
        embedder_ok = embedder_status.get("status") == "ok"

        index_stats = self.indexer.stats()

        # Overall status
        if db_ok and embedder_ok:
            status = "ok"
        elif db_ok:
            status = "degraded"
        else:
            status = "down"

        return {
            "status": status,
            "db_ok": db_ok,
            "embedder_ok": embedder_ok,
            "last_index": index_stats.last_index_time,
            "indexed_items": index_stats.indexed_items,
            "plugin_version": PLUGIN_VERSION,
        }

    def status(self) -> dict:
        """
        Get memory system status summary.

        Returns:
            Dict with index and storage stats.
        """
        index_stats = self.indexer.stats()
        latest_backup = self.backup_manager.latest_backup()
        backup_age = None
        if latest_backup:
            backup_age = latest_backup.get("age_seconds")

        return {
            "indexed_docs": index_stats.indexed_items,
            "total_docs": index_stats.total_items,
            "last_sync": index_stats.last_index_time,
            "last_backup_age_seconds": backup_age,
            "embedder_url": self.config.lm_studio_url,
            "embedder_model": self.config.embedding_model,
            "plugin_version": PLUGIN_VERSION,
            "agent_id": self.config.agent_id,
        }

    # --- Version ---

    def version_check(self) -> dict:
        """
        Get version info for observability (non-blocking, Option B).

        Returns:
            Dict with version status.
        """
        return version_status()

    def _log_version(self) -> None:
        """
        Log version info on startup (Option B: non-blocking).
        """
        info = check_version()
        logger.info(
            "Memory plugin v%s (source: %s)",
            info.current_version,
            info.source,
        )

    # --- Backup control ---

    def trigger_backup(self) -> bool:
        """
        Trigger an immediate backup.

        Returns:
            True if backup succeeded, False otherwise.
        """
        result = self.backup_scheduler.snapshot_now()
        return result is not None

    def list_backups(self) -> list[dict]:
        """List all available backups."""
        return self.backup_manager.list_backups()

    def shutdown(self) -> None:
        """Gracefully shut down the plugin."""
        self.backup_scheduler.stop()
        self.indexer.shutdown()
        self.storage.close()

    # --- Helpers ---

    def _item_to_dict(self, item: MemoryItem) -> dict:
        """Convert a MemoryItem to a dict representation."""
        return {
            "id": item.id,
            "content": item.content,
            "tags": item.tags,
            "source": item.source,
            "created_at": item.created_at,
            "modified_at": item.modified_at,
        }


# --- CLI entry point for standalone mode ---

def main():
    """Run the plugin as a standalone HTTP server (optional)."""
    import argparse

    parser = argparse.ArgumentParser(description="DWG Assistant Memory Plugin")
    parser.add_argument("--config", help="Path to config JSON file")
    parser.add_argument("--agent-id", help="Agent ID override")
    parser.add_argument("--port", type=int, default=7449, help="HTTP server port")
    args = parser.parse_args()

    config = load_config(config_path=args.config, agent_id=args.agent_id)
    memory = AgentMemory(config)

    print(f"Memory plugin started for agent: {config.agent_id}")
    print(f"  DB: {config.db_path}")
    print(f"  Embedder: {config.embedding_model} @ {config.lm_studio_url}")
    print(f"  Plugin version: {PLUGIN_VERSION}")
    print(f"  Backup interval: {config.backup_interval}s")

    # In v1, the plugin runs as a library imported by the agent.
    # A future version may add an HTTP API server here.
    print("Plugin initialized. Import and use AgentMemory class directly.")

    return 0


if __name__ == "__main__":
    sys.exit(main())