#!/usr/bin/env bash
# search-server.sh — Run the assistant memory search HTTP server
# Usage: ./search-server.sh [config-json-path]
#   config-json-path : Path to config.json (default: ./config.json in same dir as script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${1:-$SCRIPT_DIR/config.json}"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: Config file not found at $CONFIG_PATH" >&2
  echo "Run bootstrap.sh first to create a config." >&2
  exit 1
fi

cd "$SCRIPT_DIR"

# Load config values
LM_STUDIO_URL=$(node -e "const c=require('./$CONFIG_PATH'); console.log(c.lmStudioUrl||'http://192.168.64.1:1234/v1/embeddings')" 2>/dev/null || echo "http://192.168.64.1:1234/v1/embeddings")
LM_STUDIO_MODEL=$(node -e "const c=require('./$CONFIG_PATH'); console.log(c.lmStudioModel||'text-embedding-qwen3-embedding-4b')" 2>/dev/null || echo "text-embedding-qwen3-embedding-4b")
SEARCH_PORT=$(node -e "const c=require('./$CONFIG_PATH'); console.log(c.searchPort||3005)" 2>/dev/null || echo "3005")
DATA_DIR=$(node -e "const c=require('./$CONFIG_PATH'); console.log(c.dataDir||'.memory')" 2>/dev/null || echo ".memory")

# Allow env var overrides
LM_STUDIO_URL="${LM_STUDIO_URL:-$LM_STUDIO_URL}"
SEARCH_PORT="${SEARCH_PORT:-3005}"

echo "[search-server] Starting..."
echo "[search-server] Config: $CONFIG_PATH"
echo "[search-server] LM Studio: $LM_STUDIO_URL"
echo "[search-server] Model: $LM_STUDIO_MODEL"
echo "[search-server] Port: $SEARCH_PORT"

# Check node_modules exists
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "Error: node_modules not found. Run 'npm install' first." >&2
  exit 1
fi

# Run the compiled JS entry point
exec node "$SCRIPT_DIR/dist/search-server.js" \
  --config "$CONFIG_PATH"
