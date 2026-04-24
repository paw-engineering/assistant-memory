# DWG Assistant Memory Plugin

Per-agent memory system for DWG Assistants — TypeScript plugin running on Marcus's VM.

## Overview

Each DWG Assistant gets its own isolated memory store with:
- **SQLite + FTS5** — full-text search with BM25 ranking
- **FAISS index** — in-memory vector index for embedding similarity
- **LM Studio embeddings** — `text-embedding-qwen3-embedding-4b` model at `http://192.168.64.1:1234`
- **Periodic backup** — 5-minute interval, last 3 snapshots retained
- **Version metadata** — plugin version logged at startup (Option A, non-blocking)

## Quick Start

```typescript
import { AgentMemory, loadConfig } from './src/plugin.js';

// Load config (env vars or config file)
const config = loadConfig({ agentId: 'dwg-assistant-1' });
const memory = new AgentMemory(config);

// Add a memory
const memoryId = memory.addMemory({
  content: 'User asked about Docker deployment',
  tags: ['docker', 'deployment'],
  source: 'context/session-123',
});

// Search (hybrid: BM25 + vector similarity)
const results = memory.search({ query: 'docker deployment', limit: 5, hybrid: true });
console.log(results.results);

// Health check
const health = memory.health();
console.log(health);

// Graceful shutdown
memory.shutdown();
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|--------------|---------|
| `AGENT_ID` | Unique agent identifier | (required) |
| `AGENT_MEMORY_CONFIG` | Path to config JSON | — |
| `AGENT_MEMORY_LM_STUDIO_URL` | LM Studio endpoint | `http://192.168.64.1:1234` |
| `AGENT_MEMORY_EMBEDDING_MODEL` | Embedding model | `text-embedding-qwen3-embedding-4b` |
| `AGENT_MEMORY_DATA_DIR` | Memory data directory | `data/agents/{agentId}/memory` |
| `AGENT_MEMORY_BACKUP_DIR` | Backup directory | `{dataDir}/backups` |
| `AGENT_MEMORY_BACKUP_INTERVAL` | Backup interval (sec) | `300` |

### Config File (`config/agents/{agentId}/memory-plugin.json`)

```json
{
  "agentId": "dwg-assistant-1",
  "persona": "Code Assistant",
  "systemPrompt": "You are a helpful coding assistant.",
  "lmStudioUrl": "http://localhost:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "dataDir": "data/agents/dwg-assistant-1/memory",
  "backupDir": "data/agents/dwg-assistant-1/memory/backups",
  "backupInterval": 300,
  "maxBackups": 3
}
```

See [`config/agents/README.md`](config/agents/README.md) for full field documentation.

## Architecture

```
src/
├── index.ts          # Main entry, exports everything
├── plugin.ts         # AgentMemory class (primary interface)
├── config.ts         # Config loading from env/file
├── memory.ts         # MemoryStore (DB + vector index combined)
├── storage.ts        # SQLite + FTS5 operations
├── embedder.ts       # LM Studio REST API client
├── faiss.ts          # FAISS vector index management
├── backup.ts         # Periodic backup scheduler
└── versioning.ts     # Plugin version logging
```

### Storage Layer (`storage.ts`)

- **memories table** — id, content, tags, source, timestamps, embedding blob
- **memories_fts** — FTS5 virtual table for full-text search
- **meta table** — key-value metadata (last_index_time, etc.)

### Embedder (`embedder.ts`)

- Calls `POST /v1/embeddings` on LM Studio
- Batch-friendly (up to `batch_size` texts per request)
- Returns raw float32 bytes packed as binary blobs

### FAISS Index (`faiss.ts`)

- In-memory vector index for cosine similarity
- **On-change**: indexes new/updated memories immediately when `addMemory`/`updateMemory` is called
- **Periodic fallback**: scans for missing embeddings every 60s (configurable via `periodicIndexMs`)

### Backup (`backup.ts`)

- Uses SQLite's native `sqlite3.backup` API for consistent snapshots
- Retains last N backups (default: 3)
- 5-minute interval (300,000ms)

### Versioning (`versioning.ts`)

- Option A (pinned) — version metadata logged at startup
- `version.ts` reads `VERSION` file and exposes `PluginVersion`
- No startup blocking — version is informational only

## API Reference

### `AgentMemory`

#### Search

```typescript
const results = memory.search({ query: 'docker deployment', limit: 5, hybrid: true });
// Returns: { results: MemoryItem[], meta: { total, searchMs, query } }
```

#### Memory CRUD

```typescript
const id = memory.addMemory({ content, tags?, source? });
const updated = memory.updateMemory(id, { content?, tags?, source? });
const deleted = memory.deleteMemory(id);
const item = memory.getMemory(id);
const items = memory.listMemories({ limit?, offset? });
```

#### System

```typescript
const health = memory.health();         // DB, embedder, indexer status
const status = memory.status();         // Stats summary
const version = memory.getVersion();    // Plugin version info
const backup = memory.triggerBackup();  // Manual backup trigger
const backups = memory.listBackups();   // List available backups
memory.shutdown();                      // Graceful shutdown
```

## Build & Run

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Lint
npm run lint

# Build (compiles TypeScript to dist/)
npm run build

# Run in dev mode (with tsx watcher)
npm run dev

# Run in production
node dist/plugin.js
```

## Testing

```bash
npm test
```

## Docker Integration

Marcus handles Docker deployment. The plugin is mounted into the container:

```bash
docker run -v $(pwd)/assistant-memory:/app/plugins/assistant-memory \
  -e AGENT_ID=dwg-assistant-1 \
  -e AGENT_MEMORY_CONFIG=/app/config/agents/dwg-assistant-1/memory-plugin.json \
  -e AGENT_MEMORY_LM_STUDIO_URL=http://host.docker.internal:1234 \
  your-dwg-image
```

## Plugin Version

Current: **1.0.0** (from `src/VERSION`)

Version metadata (Option A, non-blocking): the plugin version is read from `src/VERSION`
at startup and logged. Marcus owns the update cadence — nothing ships without an
explicit version bump in the agent's config.