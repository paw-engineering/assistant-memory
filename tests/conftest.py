#!/usr/bin/env python3
"""
Pytest configuration and fixtures for assistant-memory tests.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test data."""
    path = tempfile.mkdtemp()
    yield path
    shutil.rmtree(path, ignore_errors=True)


@pytest.fixture
def sample_texts():
    """Sample texts for embedding tests."""
    return [
        "The agent remembers to check the inbox every morning.",
        "Marcus prefers YAML config over JSON for simple configs.",
        "All continuous workers run on the bot-shared machine.",
    ]


@pytest.fixture
def sample_chunks():
    """Sample memory chunks for store tests."""
    return [
        {
            "id": "file_abc123_0",
            "file_path": "/tmp/test/file1.md",
            "chunk_index": 0,
            "content": "This is the first chunk of memory.",
            "embedding": [0.1] * 2560,
            "created_at": 1713000000000,
            "modified_at": 1713000000000,
        },
        {
            "id": "file_abc123_1",
            "file_path": "/tmp/test/file1.md",
            "chunk_index": 1,
            "content": "This is the second chunk of memory.",
            "embedding": [0.2] * 2560,
            "created_at": 1713000001000,
            "modified_at": 1713000001000,
        },
        {
            "id": "file_def456_0",
            "file_path": "/tmp/test/file2.md",
            "chunk_index": 0,
            "content": "A different file with different content.",
            "embedding": [0.3] * 2560,
            "created_at": 1713000002000,
            "modified_at": 1713000002000,
        },
    ]
