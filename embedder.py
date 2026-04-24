"""
LM Studio embedding integration.

Calls the local LM Studio server to generate embeddings for text chunks.
Uses the REST API at localhost:1234 (or configured URL).
"""

import json
import math
import struct
import time
from typing import Optional

import requests

from config import MemoryConfig


class EmbedderError(Exception):
    """Raised when embedding generation fails."""
    pass


class Embedder:
    """
    Generates embeddings via LM Studio REST API.

    Supports:
    - Batch embedding for efficiency
    - Fallback to raw text if service unavailable
    - Configurable endpoint and model
    """

    DEFAULT_TIMEOUT = 60  # seconds for embedding call

    def __init__(self, config: MemoryConfig):
        """
        Initialize the embedder.

        Args:
            config: MemoryConfig with LM Studio settings.
        """
        self.config = config
        self.base_url = config.lm_studio_url.rstrip("/")
        self.model = config.embedding_model
        self.dimension = config.embedding_dimension
        self.batch_size = config.batch_size

    def embed(self, text: str) -> Optional[bytes]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed.

        Returns:
            Raw bytes of embedding vector, or None on failure.
        """
        result = self._embed_batch([text])
        return result[0] if result else None

    def embed_batch(self, texts: list[str]) -> list[Optional[bytes]]:
        """
        Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed.

        Returns:
            List of embedding bytes (or None for failed embeddings).
        """
        return self._embed_batch(texts)

    def _embed_batch(self, texts: list[str]) -> list[Optional[bytes]]:
        """
        Internal batch embedding via LM Studio API.

        API: POST /v1/embeddings
        Body: {"model": "text-embedding-qwen3-embedding-4b", "input": [...]}
        Response: {"data": [{"embedding": [float, ...]}, ...]}
        """
        if not texts:
            return []

        url = f"{self.base_url}/v1/embeddings"
        payload = {
            "model": self.model,
            "input": texts,
        }

        try:
            response = requests.post(
                url,
                json=payload,
                timeout=self.DEFAULT_TIMEOUT,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()

            embeddings = []
            for item in data.get("data", []):
                vector = item.get("embedding", [])
                if len(vector) == self.dimension:
                    # Pack floats into bytes
                    embeddings.append(self._pack_floats(vector))
                else:
                    embeddings.append(None)

            return embeddings

        except requests.exceptions.Timeout:
            raise EmbedderError(f"LM Studio timeout after {self.DEFAULT_TIMEOUT}s")
        except requests.exceptions.ConnectionError:
            raise EmbedderError(f"Could not connect to LM Studio at {self.base_url}")
        except requests.exceptions.HTTPError as e:
            raise EmbedderError(f"LM Studio HTTP error: {e}")
        except (json.JSONDecodeError, KeyError) as e:
            raise EmbedderError(f"Unexpected LM Studio response: {e}")

    def _pack_floats(self, vector: list[float]) -> bytes:
        """Pack a list of floats into a raw bytes blob."""
        # Convert to bytes using struct pack (little-endian float32)
        return struct.pack(f"<{len(vector)}f", *vector)

    @staticmethod
    def unpack_floats(data: bytes, dimension: int) -> list[float]:
        """Unpack raw bytes back to a list of floats."""
        expected_len = dimension * 4
        if len(data) != expected_len:
            raise ValueError(
                f"Blob size {len(data)} does not match expected {expected_len} "
                f"for dimension {dimension}"
            )
        return list(struct.unpack(f"<{dimension}f", data))

    def is_available(self) -> bool:
        """
        Check if LM Studio is reachable and has the model loaded.

        Returns:
            True if embedder is healthy, False otherwise.
        """
        try:
            url = f"{self.base_url}/v1/models"
            response = requests.get(url, timeout=5)
            if response.status_code != 200:
                return False
            models = response.json().get("data", [])
            # Check if our model is in the list
            return any(self.model in m.get("id", "") for m in models)
        except Exception:
            return False

    def health_check(self) -> dict:
        """
        Check embedder health status.

        Returns:
            Dict with status info.
        """
        try:
            url = f"{self.base_url}/v1/models"
            response = requests.get(url, timeout=5)
            models = response.json().get("data", [])
            model_loaded = any(self.model in m.get("id", "") for m in models)
            return {
                "status": "ok" if model_loaded else "model_not_loaded",
                "url": self.base_url,
                "model": self.model,
                "available_models": [m.get("id") for m in models],
            }
        except requests.exceptions.Timeout:
            return {"status": "timeout", "url": self.base_url}
        except requests.exceptions.ConnectionError:
            return {"status": "unreachable", "url": self.base_url}
        except Exception as e:
            return {"status": "error", "error": str(e)}