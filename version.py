"""
Version management for the DWG Assistant Memory Plugin.

Uses Option B (base image) versioning — no version pinning, no blocking.
The plugin logs its version for observability but never blocks on
version mismatches. Assistants update at next restart from base image rebuild.

Marcus controls what ships via base image updates, not per-agent config.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# Plugin version — bump this when making changes
PLUGIN_VERSION = "1.0.0"

# VERSION file path (Option B: read-only, no network check)
VERSION_FILE = os.environ.get(
    "AGENT_MEMORY_VERSION_FILE",
    os.path.join(os.path.dirname(__file__), "VERSION")
)


@dataclass
class VersionInfo:
    """Version information for the plugin."""
    current_version: str
    source: str = "local"
    checked_at: Optional[int] = None


def get_plugin_version() -> str:
    """Get the current plugin version string."""
    return PLUGIN_VERSION


def check_version() -> VersionInfo:
    """
    Option B version check: read VERSION file if it exists, log result.

    This never blocks. If the VERSION file is missing or unreadable,
    the plugin logs and continues anyway.
    """
    version_file = VERSION_FILE
    if version_file and Path(version_file).exists():
        try:
            content = Path(version_file).read_text().strip()
            if content:
                return VersionInfo(current_version=content, source="file")
        except Exception:
            pass

    return VersionInfo(current_version=PLUGIN_VERSION, source="builtin")


def version_status() -> dict:
    """
    Get a dict summary of version status for reporting.

    Returns:
        Dict with version status fields (non-blocking).
    """
    info = check_version()
    return {
        "plugin_version": info.current_version,
        "source": info.source,
        "update_available": False,  # Option B: never blocks on updates
        "status": "current",
    }