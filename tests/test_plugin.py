#!/usr/bin/env python3
"""
Tests for plugin.py — main memory plugin with AgentMemory class.
"""

import json
import os
import tempfile
import time

import pytest

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugin import AgentMemory
from config import MemoryConfig


class TestAgentMemory:
    """Tests for AgentMemory class."""

    @pytest.fixture
    def memory_plugin(self, tmp_path):
        """Create an AgentMemory instance with a temp directory."""
        data_dir = str(tmp_path / "data")
        db_path = str(tmp_path / "memory.db")
        os.makedirs(data_dir, exist_ok=True)

        cfg = MemoryConfig(
            agent_id="test-agent",
            data_dir=data_dir,
            db_path=db_path,
            lm_studio_url="http://192.168.64.1:1234/v1",
            embedding_model="text-embedding-qwen3-embedding-4b",
            backup_interval=60,
        )
        cfg._initialized = True

        plugin = AgentMemory(config=cfg)
        yield plugin
        plugin.shutdown()

    def test_add_memory(self, memory_plugin):
        """Test adding a memory item."""
        memory_id = memory_plugin.add_memory(
            content="Remember that Marcus prefers YAML config",
            tags=["config", "marcus"],
            source="/tmp/test.md",
        )
        assert memory_id is not None
        assert isinstance(memory_id, str)

    def test_add_memory_default_tags(self, memory_plugin):
        """Test adding memory with default empty tags."""
        memory_id = memory_plugin.add_memory(content="Simple memory")
        assert memory_id is not None

        retrieved = memory_plugin.get_memory(memory_id)
        assert retrieved is not None
        assert retrieved["content"] == "Simple memory"
        assert retrieved["tags"] == []

    def test_get_memory(self, memory_plugin):
        """Test retrieving a memory item."""
        memory_id = memory_plugin.add_memory(
            content="Test memory content",
            tags=["test"],
        )
        retrieved = memory_plugin.get_memory(memory_id)
        assert retrieved is not None
        assert retrieved["id"] == memory_id
        assert retrieved["content"] == "Test memory content"
        assert retrieved["tags"] == ["test"]

    def test_get_memory_not_found(self, memory_plugin):
        """Test getting non-existent memory returns None."""
        result = memory_plugin.get_memory("non-existent-id")
        assert result is None

    def test_update_memory(self, memory_plugin):
        """Test updating a memory item."""
        memory_id = memory_plugin.add_memory(
            content="Original content",
            tags=["original"],
        )

        success = memory_plugin.update_memory(
            memory_id,
            content="Updated content",
            tags=["updated"],
        )
        assert success is True

        retrieved = memory_plugin.get_memory(memory_id)
        assert retrieved["content"] == "Updated content"
        assert retrieved["tags"] == ["updated"]

    def test_update_memory_not_found(self, memory_plugin):
        """Test updating non-existent memory returns False."""
        success = memory_plugin.update_memory(
            "non-existent-id",
            content="New content",
        )
        assert success is False

    def test_delete_memory(self, memory_plugin):
        """Test deleting a memory item."""
        memory_id = memory_plugin.add_memory(content="To be deleted")
        assert memory_plugin.get_memory(memory_id) is not None

        success = memory_plugin.delete_memory(memory_id)
        assert success is True

        assert memory_plugin.get_memory(memory_id) is None

    def test_delete_memory_not_found(self, memory_plugin):
        """Test deleting non-existent memory returns False."""
        success = memory_plugin.delete_memory("non-existent-id")
        assert success is False

    def test_list_memories(self, memory_plugin):
        """Test listing all memories."""
        memory_plugin.add_memory(content="Memory 1", tags=["test"])
        memory_plugin.add_memory(content="Memory 2", tags=["test"])
        memory_plugin.add_memory(content="Memory 3", tags=["test"])

        memories = memory_plugin.list_memories()
        assert len(memories) == 3

    def test_list_memories_empty(self, memory_plugin):
        """Test listing empty memories."""
        memories = memory_plugin.list_memories()
        assert memories == []

    def test_search_fts(self, memory_plugin):
        """Test FTS search returns results."""
        memory_plugin.add_memory(
            content="The agent should check the inbox every morning",
            tags=["email", "task"],
        )
        memory_plugin.add_memory(
            content="Marcus prefers YAML over JSON",
            tags=["config"],
        )

        results = memory_plugin.search("inbox", limit=5)
        assert "results" in results
        assert "meta" in results
        assert isinstance(results["results"], list)

    def test_search_no_results(self, memory_plugin):
        """Test search with no results."""
        memory_plugin.add_memory(content="Unrelated content")

        results = memory_plugin.search("xyzzy not found")
        assert results["meta"]["total"] == 0

    def test_search_limit(self, memory_plugin):
        """Test search respects limit."""
        for i in range(5):
            memory_plugin.add_memory(content=f"Memory number {i}")

        results = memory_plugin.search("memory", limit=2)
        assert len(results["results"]) <= 2

    def test_health(self, memory_plugin):
        """Test health check returns expected fields."""
        health = memory_plugin.health()
        assert "status" in health
        assert "db_ok" in health
        assert "embedder_ok" in health
        assert "plugin_version" in health

    def test_status(self, memory_plugin):
        """Test status returns expected fields."""
        status = memory_plugin.status()
        assert "indexed_docs" in status
        assert "total_docs" in status
        assert "plugin_version" in status
        assert "agent_id" in status

    def test_version_check(self, memory_plugin):
        """Test version check returns version info (Option B, non-blocking)."""
        result = memory_plugin.version_check()
        assert "plugin_version" in result
        assert "source" in result
        assert "status" in result

    def test_trigger_backup(self, memory_plugin):
        """Test triggering a backup."""
        memory_plugin.add_memory(content="Backup test content")
        success = memory_plugin.trigger_backup()
        assert success is True

    def test_list_backups(self, memory_plugin):
        """Test listing backups."""
        memory_plugin.add_memory(content="Backup test")
        memory_plugin.trigger_backup()

        backups = memory_plugin.list_backups()
        assert isinstance(backups, list)

    def test_shutdown(self, memory_plugin):
        """Test shutdown doesn't raise."""
        # Should not raise
        memory_plugin.shutdown()


class TestPluginIntegration:
    """Integration tests with mock embedder."""

    @pytest.fixture
    def plugin_with_mock(self, tmp_path):
        """Create plugin with mock embedder."""
        data_dir = str(tmp_path / "data")
        db_path = str(tmp_path / "memory.db")
        os.makedirs(data_dir, exist_ok=True)

        cfg = MemoryConfig(
            agent_id="integration-test",
            data_dir=data_dir,
            db_path=db_path,
            lm_studio_url="http://192.168.64.1:1234/v1",
            embedding_model="text-embedding-qwen3-embedding-4b",
            backup_interval=60,
        )
        cfg._initialized = True

        plugin = AgentMemory(config=cfg)
        yield plugin
        plugin.shutdown()

    def test_full_memory_cycle(self, plugin_with_mock):
        """Test complete memory lifecycle."""
        # Add
        mem_id = plugin_with_mock.add_memory(
            content="Important information",
            tags=["test", "important"],
        )

        # Get
        mem = plugin_with_mock.get_memory(mem_id)
        assert mem is not None
        assert mem["content"] == "Important information"

        # Update
        plugin_with_mock.update_memory(mem_id, content="Updated information")
        mem = plugin_with_mock.get_memory(mem_id)
        assert mem["content"] == "Updated information"

        # Delete
        plugin_with_mock.delete_memory(mem_id)
        assert plugin_with_mock.get_memory(mem_id) is None

    def test_multiple_memories(self, plugin_with_mock):
        """Test adding multiple memories."""
        ids = []
        for i in range(3):
            mem_id = plugin_with_mock.add_memory(content=f"Memory {i}")
            ids.append(mem_id)

        memories = plugin_with_mock.list_memories()
        assert len(memories) == 3
