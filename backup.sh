#!/usr/bin/env bash
# backup.sh — Continuous backup manager for assistant memory
# Usage: ./backup.sh <agent-id> [daemon|once|sync]
#   daemon  : Run continuous backup loop (default)
#   once    : Run a single backup and exit
#   sync    : Run backup synchronously every 5 minutes (for cron)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${1:-}"
MODE="${2:-daemon}"

if [[ -z "$AGENT_ID" ]]; then
  echo "Usage: backup.sh <agent-id> [daemon|once|sync]" >&2
  exit 1
fi

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}"
DATA_DIR="$CACHE_DIR/assistant-memory/$AGENT_ID"
CONFIG_FILE="$DATA_DIR/config.json"
BACKUP_DIR="$DATA_DIR/.memory/backups"
MEMORY_DB="$DATA_DIR/.memory/memory_records.db"

INTERVAL_MINUTES=5
INTERVAL_MS=$((INTERVAL_MINUTES * 60 * 1000))

log() {
  echo "[backup][$(date '+%Y-%m-%dT%H:%M:%S')] $*"
}

# Validate prerequisites
if [[ ! -f "$MEMORY_DB" ]]; then
  log "WARNING: memory DB not found at $MEMORY_DB — nothing to backup yet"
  exit 0
fi

do_backup() {
  local ts
  ts=$(date '+%Y%m%dT%H%M%S')
  local backup_file="$BACKUP_DIR/backup-${ts}.db"
  local latest_link="$BACKUP_DIR/latest.db"

  # Ensure backup dir exists
  mkdir -p "$BACKUP_DIR"

  # Copy DB (SQLite supports concurrent reads)
  if cp "$MEMORY_DB" "$backup_file" 2>/dev/null; then
    # Update symlink to latest
    ln -sf "$(basename "$backup_file")" "$latest_link"
    log "Backup complete: $backup_file"

    # Prune old backups — keep last 10
    cd "$BACKUP_DIR" || exit 1
    ls -1t backup-*.db 2>/dev/null | tail -n +11 | xargs -r rm
  else
    log "ERROR: failed to copy $MEMORY_DB"
    return 1
  fi
}

case "$MODE" in
  once)
    do_backup
    ;;
  sync)
    log "Sync mode: backing up every ${INTERVAL_MINUTES}m"
    while true; do
      do_backup
      sleep "$INTERVAL_MS"
    done
    ;;
  daemon|*)
    log "Daemon mode: backing up every ${INTERVAL_MINUTES}m (PID=$$)"
    log "Use 'kill $$(pgrep -f "backup.sh $AGENT_ID")' to stop"

    # Write PID file
    mkdir -p "$DATA_DIR/.memory"
    echo "$$" > "$DATA_DIR/.memory/backup.pid"

    trap 'rm -f "$DATA_DIR/.memory/backup.pid"; log "Stopped"; exit 0' INT TERM

    while true; do
      do_backup
      sleep "$INTERVAL_MS"
    done
    ;;
esac
