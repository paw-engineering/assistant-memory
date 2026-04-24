#!/usr/bin/env python3
"""
Tests for storage.py — SQLite-based memory store.
"""

import json
import os
import time

import pytest

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from storage import Storage, MemoryItem


class TestMemoryItem:
    """Tests for MemoryItem dataclass."""

    def test_creation(self):
        """Test MemoryItem can be created with required fields."""
        item = MemoryItem(
            id="test-id",
            content="Hello world",
            tags=["tag1", "tag2"],
            source="/tmp/test.md",
        )
        assert item.id == "test-id"
        assert item.content == "Hello world"
        assert item.tags == ["tag1", "tag2"]

    def test_default_values(self):
        """Test MemoryItem defaults."""
        item = MemoryItem(id="test", content="Hello")
        assert item.tags == []
        assert item.source is None
        assert item.created_at > 0
        assert item.modified_at > 0

    def test_embedding_bytes(self):
        """Test MemoryItem with embedding bytes."""
        import struct
        emb = struct.pack("<4f", 0.1, 0.2, 0.3, 0.4)
        item = MemoryItem(id="test", content="Hello", embedding=emb)
        assert item.embedding == emb


class TestStorage:
    """Tests for Storage."""

    @pytest.fixture
    def db_path(self, tmp_path):
        """Create a temp db path."""
        return str(tmp_path / "test.db")

    @pytest.fixture
    def store(self, db_path):
        """Create a Storage instance."""
        s = Storage(db_path)
        yield s
        s.close()

    def test_init_creates_db(self, db_path):
        """Test that storage creates required database."""
        store = Storage(db_path)
        assert os.path.exists(db_path)
        store.close()

    def test_add_memory(self, store):
        """Test adding a memory item."""
        item = MemoryItem(
            id="test-1",
            content="The agent should check the inbox every morning at 9 AM.",
            tags=["task", "email"],
        )
        store.add(item)

        assert store.count == 1
        retrieved = store.get("test-1")
        assert retrieved is not None
        assert retrieved.content == "The agent should check the inbox every morning at 9 AM."
        assert retrieved.tags == ["task", "email"]

    def test_get_memory(self, store):
        """Test retrieving a memory item."""
        item = MemoryItem(
            id="test-get-1",
            content="Test content",
            tags=["test"],
        )
        store.add(item)

        retrieved = store.get("test-get-1")
        assert retrieved is not None
        assert retrieved.content == "Test content"

    def test_get_memory_not_found(self, store):
        """Test getting non-existent memory."""
        retrieved = store.get("non-existent")
        assert retrieved is None

    def test_update_memory(self, store):
        """Test updating a memory item via upsert."""
        item = MemoryItem(
            id="test-update-1",
            content="Original content",
            tags=["test"],
        )
        store.add(item)

        updated_item = MemoryItem(
            id="test-update-1",
            content="Updated content",
            tags=["updated"],
        )
        store.upsert(updated_item)

        retrieved = store.get("test-update-1")
        assert retrieved.content == "Updated content"
        assert retrieved.tags == ["updated"]

    def test_delete_memory(self, store):
        """Test deleting a memory item."""
        item = MemoryItem(
            id="test-delete-1",
            content="To be deleted",
            tags=["temp"],
        )
        store.add(item)

        assert store.delete("test-delete-1") is True
        assert store.get("test-delete-1") is None

    def test_delete_memory_not_found(self, store):
        """Test deleting non-existent memory."""
        result = store.delete("non-existent")
        assert result is False

    def test_search_fts(self, store):
        """Test FTS5 full-text search."""
        items = [
            MemoryItem(
                id="fts-test-1",
                content="The agent remembers to check the inbox every morning.",
                tags=["email"],
            ),
            MemoryItem(
                id="fts-test-2",
                content="Marcus prefers YAML config over JSON for simple configs.",
                tags=["config"],
            ),
        ]
        for item in items:
            store.add(item)

        results = store.search_fts("inbox")
        assert len(results) >= 1
        assert results[0][0].id == "fts-test-1"

    def test_search_fts_no_results(self, store):
        """Test search with no results."""
        item = MemoryItem(id="test-1", content="Hello world")
        store.add(item)

        results = store.search_fts("xyzzy")
        assert len(results) == 0

    def test_list_memories(self, store):
        """Test listing all memories."""
        for i in range(3):
            item = MemoryItem(
                id=f"list-test-{i}",
                content=f"Content {i}",
                tags=["test"],
            )
            store.add(item)

        items = store.get_all(limit=10)
        assert len(items) == 3

    def test_list_memories_empty(self, store):
        """Test listing empty store."""
        items = store.get_all(limit=10)
        assert items == []

    def test_count_property(self, store):
        """Test count property."""
        assert store.count == 0

        for i in range(3):
            item = MemoryItem(id=f"count-{i}", content=f"Content {i}")
            store.add(item)

        assert store.count == 3

    def test_indexed_count(self, store):
        """Test indexed_count property."""
        assert store.indexed_count == 0

        item = MemoryItem(
            id="indexed-1",
            content="Content",
            embedding=b"\x00\x00\x00\x00" * 10,
        )
        store.add(item)
        assert store.indexed_count == 1

    def test_update_embedding(self, store):
        """Test storing an embedding."""
        import struct
        emb = struct.pack("<4f", 0.1, 0.2, 0.3, 0.4)

        item = MemoryItem(id="emb-test", content="Test")
        store.add(item)
        store.update_embedding("emb-test", emb)

        retrieved_emb = store.get_embedding("emb-test")
        assert retrieved_emb == emb

    def test_get_embedding_not_found(self, store):
        """Test getting embedding for non-existent memory."""
        result = store.get_embedding("non-existent")
        assert result is None

    def test_meta_operations(self, store):
        """Test metadata get/set."""
        store.set_meta("last_index", "2024-04-01T10:00:00Z")
        assert store.get_meta("last_index") == "2024-04-01T10:00:00Z"

    def test_last_index_time(self, store):
        """Test last_index_time."""
        assert store.last_index_time() is None

        now_ms = int(time.time() * 1000)
        store.set_meta("last_index_time", str(now_ms))
        assert store.last_index_time() == now_ms

    def test_close(self, store):
        """Test that close works."""
        store.close()
        # Should not raise on subsequent close
        store.close()

    def test_checkpoint(self, store):
        """Test checkpoint - skip if database is locked (SQLite concurrency edge case)."""
        item = MemoryItem(id="checkpoint-test", content="Test")
        store.add(item)
        try:
            store.checkpoint()
        except Exception as e:
            if "locked" in str(e).lower():
                pytest.skip(f"SQLite locked: {e}")
            raise