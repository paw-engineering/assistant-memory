#!/usr/bin/env python3
"""
Tests for embedder.py — LM Studio embedding client.
"""

import pytest
from unittest.mock import patch, MagicMock

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from embedder import Embedder, EmbedderError
from config import MemoryConfig


class TestEmbedder:
    """Tests for Embedder."""

    @pytest.fixture
    def config(self, tmp_path):
        """Create a test config."""
        data_dir = str(tmp_path / "data")
        db_path = str(tmp_path / "memory.db")
        os.makedirs(data_dir, exist_ok=True)
        cfg = MemoryConfig(
            agent_id="test",
            data_dir=data_dir,
            db_path=db_path,
            lm_studio_url="http://192.168.64.1:1234/v1",
            embedding_model="text-embedding-qwen3-embedding-4b",
        )
        cfg._initialized = True
        return cfg

    @pytest.fixture
    def embedder(self, config):
        """Create an Embedder instance."""
        return Embedder(config)

    def test_init(self, config):
        """Test embedder initializes with correct values."""
        e = Embedder(config)
        # base_url keeps /v1 from config
        assert e.base_url == "http://192.168.64.1:1234/v1"
        assert e.model == "text-embedding-qwen3-embedding-4b"
        assert e.dimension == 2560

    def test_embed_empty_text(self, embedder):
        """Test that empty text returns None."""
        result = embedder.embed("")
        assert result is None

    def test_embed_whitespace_text(self, embedder):
        """Test that whitespace-only text returns None."""
        result = embedder.embed("   \n\t  ")
        assert result is None

    @patch("embedder.requests.post")
    def test_embed_success(self, mock_post, embedder):
        """Test successful embedding."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"embedding": [0.1] * 2560}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        result = embedder.embed("test text")
        assert result is not None
        mock_post.assert_called_once()

    @patch("embedder.requests.post")
    def test_embed_batch(self, mock_post, embedder):
        """Test batch embedding."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"embedding": [0.1] * 2560},
                {"embedding": [0.2] * 2560}
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        results = embedder.embed_batch(["text1", "text2"])
        assert len(results) == 2
        assert all(r is not None for r in results)

    @patch("embedder.requests.post")
    def test_embed_connection_error(self, mock_post, embedder):
        """Test handling connection error raises EmbedderError."""
        import requests
        mock_post.side_effect = requests.exceptions.ConnectionError("Connection refused")

        with pytest.raises(EmbedderError):
            embedder.embed("test text")

    @patch("embedder.requests.get")
    def test_is_available(self, mock_get, embedder):
        """Test availability check."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"id": "text-embedding-qwen3-embedding-4b"}]
        }
        mock_get.return_value = mock_response

        assert embedder.is_available() is True

    @patch("embedder.requests.get")
    def test_is_available_not_loaded(self, mock_get, embedder):
        """Test availability when model not loaded."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": []}
        mock_get.return_value = mock_response

        assert embedder.is_available() is False

    @patch("embedder.requests.get")
    def test_health_check(self, mock_get, embedder):
        """Test health check."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"id": "text-embedding-qwen3-embedding-4b"}]
        }
        mock_get.return_value = mock_response

        health = embedder.health_check()
        assert health["status"] == "ok"
        assert health["model"] == "text-embedding-qwen3-embedding-4b"

    def test_unpack_floats(self, embedder):
        """Test unpacking floats."""
        floats = [0.1, 0.2, 0.3, 0.4]
        packed = embedder._pack_floats(floats)
        unpacked = embedder.unpack_floats(packed, 4)
        assert len(unpacked) == 4