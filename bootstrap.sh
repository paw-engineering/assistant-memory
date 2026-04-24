#!/usr/bin/env bash
# bootstrap.sh — Bootstrap a per-agent assistant memory plugin instance
# Usage: ./bootstrap.sh <agent-id> [config-json]
#   agent-id   : Unique identifier for this agent (e.g., "dwg-assistant-01")
#   config-json : Optional JSON config overrides (single-line JSON string)
#
# Bootstrap process:
#   1. Resolve plugin install dir (same dir as this script)
#   2. Create per-agent data dir at ~/.cache/assistant-memory/<agent-id>/
#   3. Write config.json (defaults + overrides)
#   4. Run a full index if context dir has files
#   5. Print the data dir path to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${1:-}"
CONFIG_OVERRIDE="${2:-}"

if [[ -z "$AGENT_ID" ]]; then
  echo "Usage: bootstrap.sh <agent-id> [config-json]" >&2
  exit 1
fi

# Resolve install dir (where this script lives)
INSTALL_DIR="$SCRIPT_DIR"

# Default config dir under ~/.cache
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}"
DATA_DIR="$CACHE_DIR/assistant-memory/$AGENT_ID"
CONFIG_DIR="$DATA_DIR"
CONFIG_FILE="$CONFIG_DIR/config.json"

mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR/.memory"
mkdir -p "$DATA_DIR/.memory/backups"
mkdir -p "$DATA_DIR/.memory/index"

# Default config
DEFAULT_CONFIG='{
  "version": 1,
  "lmStudioUrl": "http://192.168.64.1:1234/v1/embeddings",
  "lmStudioModel": "text-embedding-qwen3-embedding-4b",
  "backupInterval": 5,
  "indexStrategy": "on-change-plus-periodic",
  "periodicInterval": 30,
  "autoRecall": false,
  "autoCapture": false,
  "captureMaxChars": 2000,
  "backupDir": ".memory/backups",
  "dataDir": ".memory"
}'

# Merge user overrides if provided
if [[ -n "$CONFIG_OVERRIDE" ]]; then
  # Use jq to deep-merge if available, otherwise just write override
  if command -v jq &>/dev/null; then
    echo "$DEFAULT_CONFIG" | jq -s '.[0] * .[1]' <(echo "$CONFIG_OVERRIDE") > "$CONFIG_FILE"
  else
    echo "$CONFIG_OVERRIDE" > "$CONFIG_FILE"
  fi
else
  echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
fi

echo "[bootstrap] Agent ID : $AGENT_ID"
echo "[bootstrap] Data dir : $DATA_DIR"
echo "[bootstrap] Config   : $CONFIG_FILE"

# Check if LM Studio is reachable
LM_STUDIO_URL=$(jq -r '.lmStudioUrl // "http://localhost:1234/v1/embeddings"' "$CONFIG_FILE")
if command -v curl &>/dev/null; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$LM_STUDIO_URL/models" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "[bootstrap] LM Studio : reachable at $LM_STUDIO_URL"
  else
    echo "[bootstrap] LM Studio : WARNING — not reachable (HTTP $HTTP_CODE)"
  fi
fi

# Check if there are markdown files to index in context dir
CONTEXT_DIR="${CONTEXT_DIR:-$DATA_DIR}"
MD_COUNT=$(find "$CONTEXT_DIR" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
echo "[bootstrap] Markdown files in context dir: $MD_COUNT"

echo ""
echo "[bootstrap] Bootstrap complete."
echo "[bootstrap] Data dir: $DATA_DIR"
echo "$DATA_DIR"
