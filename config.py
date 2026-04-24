"""
Per-agent configuration loader for the DWG Assistant Memory Plugin.

Loads config from environment variables and optionally a JSON config file.
Each agent gets its own isolated config with its own SQLite DB and data directories.

Uses Option B (base image) versioning — no version pinning.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


DEFAULT_LM_STUDIO_URL = "http://192.168.64.1:1234"
DEFAULT_EMBEDDING_MODEL = "text-embedding-qwen3-embedding-4b"
DEFAULT_EMBEDDING_DIM = 2560
DEFAULT_BATCH_SIZE = 32
DEFAULT_BACKUP_INTERVAL = 300  # 5 minutes
DEFAULT_INDEX_INTERVAL = 60  # 1 minute
DEFAULT_MAX_BACKUPS = 3
DEFAULT_WATCH_DIRS = ["memory/", "workspace/"]


@dataclass
class MemoryConfig:
    """Configuration for a single agent's memory plugin instance."""

    # Agent identity
    agent_id: str

    # LM Studio connection
    lm_studio_url: str = DEFAULT_LM_STUDIO_URL
    embedding_model: str = DEFAULT_EMBEDDING_MODEL
    embedding_dimension: int = DEFAULT_EMBEDDING_DIM
    batch_size: int = DEFAULT_BATCH_SIZE

    # Data paths (per-agent isolation)
    data_dir: str = ""
    db_path: str = ""
    backup_dir: str = ""

    # Directories to watch for changes
    watch_dirs: list[str] = field(default_factory=lambda: DEFAULT_WATCH_DIRS.copy())

    # Backup settings
    backup_interval: int = DEFAULT_BACKUP_INTERVAL  # seconds
    max_backups: int = DEFAULT_MAX_BACKUPS

    # Index rebuild interval (periodic fallback)
    index_rebuild_interval: int = DEFAULT_INDEX_INTERVAL  # seconds

    def __post_init__(self):
        """Derive default paths from agent_id if not specified."""
        if not self.data_dir:
            self.data_dir = f"data/agents/{self.agent_id}/memory/"
        if not self.db_path:
            self.db_path = os.path.join(self.data_dir, "memory.db")
        if not self.backup_dir:
            self.backup_dir = os.path.join(self.data_dir, "backups")


def load_config(config_path: Optional[str] = None, agent_id: Optional[str] = None) -> MemoryConfig:
    """
    Load configuration from file and/or environment variables.

    Priority (highest to lowest):
    1. Explicit config_path argument
    2. AGENT_MEMORY_CONFIG environment variable
    3. Default config.json in data dir

    Args:
        config_path: Explicit path to config JSON file.
        agent_id: Agent ID (required, either in config file or as env var AGENT_ID).

    Returns:
        MemoryConfig instance.

    Raises:
        ValueError: If required fields are missing.
    """
    config_data = {}

    # 1. Try loading from file (handle camelCase keys from JSON)
    config_file = config_path or os.environ.get("AGENT_MEMORY_CONFIG")
    if config_file and os.path.exists(config_file):
        with open(config_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
            # Normalize camelCase keys to snake_case
            config_data = _normalize_keys(raw)

    # 2. Env vars override file (prefix: AGENT_MEMORY_)
    env_overrides = {
        "agent_id": os.environ.get("AGENT_ID"),
        "lm_studio_url": os.environ.get("AGENT_MEMORY_LM_STUDIO_URL"),
        "embedding_model": os.environ.get("AGENT_MEMORY_EMBEDDING_MODEL"),
        "embedding_dimension": _env_int("AGENT_MEMORY_EMBEDDING_DIM"),
        "batch_size": _env_int("AGENT_MEMORY_BATCH_SIZE"),
        "data_dir": os.environ.get("AGENT_MEMORY_DATA_DIR"),
        "db_path": os.environ.get("AGENT_MEMORY_DB_PATH"),
        "backup_dir": os.environ.get("AGENT_MEMORY_BACKUP_DIR"),
        "backup_interval": _env_int("AGENT_MEMORY_BACKUP_INTERVAL"),
        "max_backups": _env_int("AGENT_MEMORY_MAX_BACKUPS"),
    }
    for key, value in env_overrides.items():
        if value is not None:
            config_data[key] = value

    # 3. Validate required fields
    agent_id = config_data.get("agent_id") or agent_id
    if not agent_id:
        raise ValueError("agent_id is required (set in config file or AGENT_ID env var)")

    config_data["agent_id"] = agent_id

    # 4. Derive paths
    if not config_data.get("data_dir"):
        config_data["data_dir"] = f"data/agents/{agent_id}/memory/"
    if not config_data.get("db_path"):
        config_data["db_path"] = os.path.join(config_data["data_dir"], "memory.db")
    if not config_data.get("backup_dir"):
        config_data["backup_dir"] = os.path.join(config_data["data_dir"], "backups")

    return MemoryConfig(**config_data)


def _normalize_keys(data: dict) -> dict:
    """Convert camelCase JSON keys to snake_case Python keys."""
    mapping = {
        "agentId": "agent_id",
        "lmStudioUrl": "lm_studio_url",
        "embeddingModel": "embedding_model",
        "embeddingDimension": "embedding_dimension",
        "batchSize": "batch_size",
        "dataDir": "data_dir",
        "dbPath": "db_path",
        "backupDir": "backup_dir",
        "watchDirs": "watch_dirs",
        "backupInterval": "backup_interval",
        "maxBackups": "max_backups",
        "indexRebuildInterval": "index_rebuild_interval",
    }
    result = {}
    for key, value in data.items():
        new_key = mapping.get(key, key)
        result[new_key] = value
    return result


def _env_int(value: Optional[str]) -> Optional[int]:
    """Parse environment variable as integer."""
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def create_config(output_path: str, **kwargs) -> MemoryConfig:
    """
    Create and save a new config file.

    Args:
        output_path: Path to write config JSON.
        **kwargs: Config fields to set.
    """
    config = MemoryConfig(**kwargs)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(_config_to_dict(config), f, indent=2)
    return config


def _config_to_dict(config: MemoryConfig) -> dict:
    """Convert config to dict for JSON serialization."""
    return {
        "agentId": config.agent_id,
        "lmStudioUrl": config.lm_studio_url,
        "embeddingModel": config.embedding_model,
        "embeddingDimension": config.embedding_dimension,
        "batchSize": config.batch_size,
        "dataDir": config.data_dir,
        "dbPath": config.db_path,
        "backupDir": config.backup_dir,
        "watchDirs": config.watch_dirs,
        "backupInterval": config.backup_interval,
        "maxBackups": config.max_backups,
        "indexRebuildInterval": config.index_rebuild_interval,
    }
