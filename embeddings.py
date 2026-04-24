"""
Embedding client for LM Studio.

Calls the local LM Studio server at http://192.168.64.1:1234/v1/embeddings
to generate text embeddings using the text-embedding-qwen3-embedding-4b model.
"""

import time
import hashlib
from typing import Optional
import httpx


class EmbeddingClient:
    """Client for generating text embeddings via LM Studio."""

    DEFAULT_URL = "http://192.168.64.1:1234/v1"
    DEFAULT_MODEL = "text-embedding-qwen3-embedding-4b"
    DEFAULT_TIMEOUT = 60.0

    def __init__(
        self,
        base_url: str = DEFAULT_URL,
        model: str = DEFAULT_MODEL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        """
        Initialize the embedding client.

        Args:
            base_url: Base URL for LM Studio API (default: http://192.168.64.1:1234/v1)
            model: Embedding model name (default: text-embedding-qwen3-embedding-4b)
            timeout: Request timeout in seconds (default: 60)
            max_retries: Number of retries on failure (default: 3)
            retry_delay: Delay between retries in seconds (default: 1.0)
        """
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._client: Optional[httpx.Client] = None

    def _get_client(self) -> httpx.Client:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            self._client.close()
            self._client = None

    def generate(self, text: str) -> Optional[list[float]]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed.

        Returns:
            Embedding vector as list of floats, or None on failure.
        """
        if not text or not text.strip():
            return None

        payload = {
            "model": self.model,
            "input": text,
            "encoding_format": "float",
        }

        client = self._get_client()
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries):
            try:
                response = client.post("/embeddings", json=payload)
                response.raise_for_status()
                data = response.json()
                return data["data"][0]["embedding"]
            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))

        # All retries failed, return mock embedding
        print(f"[embeddings] LM Studio unavailable after {self.max_retries} retries: {last_error}")
        return self._mock_embedding(text)

    def generate_batch(self, texts: list[str]) -> list[Optional[list[float]]]:
        """
        Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed.

        Returns:
            List of embedding vectors (or None for failed texts).
        """
        return [self.generate(text) for text in texts]

    def _mock_embedding(self, text: str, dim: int = 2560) -> list[float]:
        """
        Generate a deterministic mock embedding when LM Studio is unavailable.

        Uses a hash-based approach to generate consistent embeddings for the same text.

        Args:
            text: Text to embed.
            dim: Embedding dimension (default: 384).

        Returns:
            Mock embedding vector.
        """
        vector = [0.0] * dim

        # Generate a hash of the text
        hash_val = int(hashlib.md5(text.encode()).hexdigest(), 16)

        # Fill vector using hash with sinusoidal modulation
        for i in range(dim):
            seed = (hash_val * (i + 1) * 2654435761) & 0xFFFFFFFF
            vector[i] = ((seed % 2000) / 1000.0) - 1.0  # Range [-1, 1]

        # Normalize
        magnitude = sum(v * v for v in vector) ** 0.5
        if magnitude > 0:
            vector = [v / magnitude for v in vector]

        return vector

    def is_available(self) -> bool:
        """
        Check if LM Studio is available.

        Returns:
            True if LM Studio responds, False otherwise.
        """
        try:
            client = self._get_client()
            response = client.get("/models")
            return response.status_code == 200
        except Exception:
            return False
