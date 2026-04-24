"""
Backup system for agent memory databases.

Runs every N seconds (default: 1 hour) and creates timestamped
snapshot copies of the SQLite database. Only retains the last N backups
(configurable, default: 3).

Uses `sqlite3.backup()` API for consistent snapshots without locking
the source database.
"""

import glob
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

from config import MemoryConfig


class BackupManager:
    """
    Manages periodic backups of the agent's memory database.

    Features:
    - Uses SQLite backup API for consistent snapshots
    - Timestamped backup directories
    - Configurable retention (max backups)
    - Manual snapshot trigger
    """

    def __init__(self, storage_db_path: str, backup_dir: str, max_backups: int = 3):
        """
        Initialize backup manager.

        Args:
            storage_db_path: Path to the SQLite database to backup.
            backup_dir: Directory to store backups in.
            max_backups: Maximum number of backups to retain.
        """
        self.db_path = storage_db_path
        self.backup_dir = backup_dir
        self.max_backups = max_backups
        os.makedirs(backup_dir, exist_ok=True)

    def snapshot(self) -> Optional[str]:
        """
        Create a snapshot backup now.

        Returns:
            Path to the backup directory if successful, None otherwise.
        """
        timestamp = int(time.time() * 1000)
        backup_subdir = os.path.join(self.backup_dir, f"backup-{timestamp}")
        os.makedirs(backup_subdir, exist_ok=True)

        backup_db = os.path.join(backup_subdir, "memory.db")

        try:
            # Use SQLite's backup API for consistent snapshot
            # Open in readonly mode on source to avoid WAL interference
            with self._open_source_readonly() as src:
                src.backup(self._open_dest(backup_db))
            self._cleanup_old_backups()
            return backup_subdir
        except Exception as e:
            # Clean up failed backup
            shutil.rmtree(backup_subdir, ignore_errors=True)
            return None

    def restore(self, backup_timestamp: int) -> bool:
        """
        Restore from a specific backup.

        Args:
            backup_timestamp: Unix timestamp (ms) of the backup to restore.

        Returns:
            True if restore successful, False otherwise.
        """
        backup_subdir = os.path.join(self.backup_dir, f"backup-{backup_timestamp}")
        backup_db = os.path.join(backup_subdir, "memory.db")

        if not os.path.exists(backup_db):
            return False

        try:
            # Close any open connections by clearing the sqlite cache
            import sqlite3
            sqlite3.connect(self.db_path).close()

            # Remove the current DB file and copy from backup
            if os.path.exists(self.db_path):
                os.remove(self.db_path)
            shutil.copy2(backup_db, self.db_path)
            return True
        except Exception:
            return False

    def list_backups(self) -> list[dict]:
        """
        List all available backups.

        Returns:
            List of dicts with timestamp and path for each backup.
        """
        pattern = os.path.join(self.backup_dir, "backup-*")
        dirs = sorted(glob.glob(pattern), reverse=True)
        backups = []
        for d in dirs:
            name = os.path.basename(d)
            ts_str = name.replace("backup-", "")
            try:
                ts = int(ts_str)
                backups.append({
                    "timestamp": ts,
                    "path": d,
                    "age_seconds": (time.time() * 1000 - ts) / 1000,
                })
            except ValueError:
                continue
        return backups

    def latest_backup(self) -> Optional[dict]:
        """Get the most recent backup info."""
        backups = self.list_backups()
        return backups[0] if backups else None

    def _cleanup_old_backups(self) -> None:
        """Remove oldest backups exceeding max_backups."""
        backups = self.list_backups()
        if len(backups) > self.max_backups:
            for backup in backups[self.max_backups:]:
                shutil.rmtree(backup["path"], ignore_errors=True)

    def _open_source_readonly(self):
        """Open source DB for backup API (read-only access)."""
        import sqlite3
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA read_uncommitted = ON")
        return conn

    def _open_dest(self, path):
        """Open the destination database for backup."""
        import sqlite3
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        return sqlite3.connect(path)


class BackupScheduler:
    """
    Runs the backup manager on a fixed interval.

    Starts a background thread that snapshots the database every N seconds.
    """

    def __init__(self, backup_manager: BackupManager, interval_seconds: int = 3600):
        """
        Initialize the scheduler.

        Args:
            backup_manager: BackupManager instance to run.
            interval_seconds: Interval between backups (default: 3600 = 1 hour).
        """
        self.backup_manager = backup_manager
        self.interval = interval_seconds
        self._timer: Optional[threading.Timer] = None
        self._running = False

    def start(self) -> None:
        """Start the periodic backup scheduler."""
        self._running = True
        self._schedule()

    def _schedule(self) -> None:
        """Schedule the next backup."""
        if not self._running:
            return
        self._timer = threading.Timer(self.interval, self._do_backup)
        self._timer.daemon = True
        self._timer.start()

    def _do_backup(self) -> None:
        """Execute a backup and schedule the next."""
        if not self._running:
            return
        try:
            self.backup_manager.snapshot()
        except Exception:
            pass
        finally:
            self._schedule()

    def stop(self) -> None:
        """Stop the scheduler."""
        self._running = False
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def snapshot_now(self) -> Optional[str]:
        """Trigger an immediate backup."""
        return self.backup_manager.snapshot()