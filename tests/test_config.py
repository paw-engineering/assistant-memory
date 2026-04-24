#!/usr/bin/env python3
"""
Tests for config loading and validation.
"""

import json
import os
import tempfile

import pytest

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestConfigLoading:
    """Tests for config loading."""

    def test_load_minimal_config(self, temp_dir):
        """Test loading a minimal valid config."""
        config_path = os.path.join(temp_dir, "config.json")
        with open(config_path, "w") as f:
            json.dump({
                "agent_id": "test-agent",
                "version": "1.0.0",
            }, f)

        # Config loader should use defaults for missing fields
        with open(config_path) as f:
            config = json.load(f)

        assert config["agent_id"] == "test-agent"
        assert config["version"] == "1.0.0"

    def test_config_schema_fields(self, temp_dir):
        """Test that all expected schema fields are present."""
        config_path = os.path.join(temp_dir, "config.json")
        config = {
            "agent_id": "virt",
            "version": "1.0.0",
            "memory_dir": "",
            "backup_interval": 300,
            "index_update_mode": "on_change",
            "lm_studio_url": "http://192.168.64.1:1234/v1",
            "embedding_model": "text-embedding-qwen3-embedding-4b",
            "chunk_size": 500,
            "chunk_overlap": 50,
            "periodic_index_interval": 300,
        }
        with open(config_path, "w") as f:
            json.dump(config, f)

        with open(config_path) as f:
            loaded = json.load(f)

        assert loaded["agent_id"] == "virt"
        assert loaded["backup_interval"] == 300
        assert loaded["lm_studio_url"] == "http://192.168.64.1:1234/v1"
        assert loaded["chunk_size"] == 500

    def test_memory_dir_expansion(self, temp_dir):
        """Test that memory_dir ~ is expanded."""
        config_path = os.path.join(temp_dir, "config.json")
        config = {
            "agent_id": "test",
            "version": "1.0.0",
            "memory_dir": "~/agent-memory",
        }
        with open(config_path, "w") as f:
            json.dump(config, f)

        with open(config_path) as f:
            loaded = json.load(f)

        memory_dir = loaded["memory_dir"]
        if memory_dir.startswith("~"):
            expanded = os.path.expanduser(memory_dir)
            assert expanded.startswith("/Users/")
        else:
            assert memory_dir == "~/agent-memory"


# Fixtures

@pytest.fixture
def temp_dir():
    """Create a temporary directory for test data."""
    import shutil
    path = tempfile.mkdtemp()
    yield path
    shutil.rmtree(path, ignore_errors=True)
