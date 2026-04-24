# Assistant Memory — Per-Agent Memory Plugin for DWG Assistants

A portable Node.js/TypeScript plugin that provides semantic memory for DWG Assistants. Each agent gets its own isolated index with embeddings powered by local LM Studio.

## Features

- **CRUD operations** — add, search, delete, update memory entries
- **Semantic search** — cosine similarity over embeddings from local LM Studio
- **Per-agent isolation** — no cross-agent data access
- **Auto-backup** — every 5 minutes (configurable)
- **HTTP API** — simple REST endpoints for agent integration
- **Portable** — single npm package, no external DB dependencies

## Quick Start

### 1. Add to your DWG Assistant Dockerfile

```dockerfile
# Copy the plugin
COPY assistant-memory /opt/assistant-memory

# Install dependencies
RUN cd /opt/assistant-memory && npm install --production

# Set environment variables
ENV ASSISTANT_MEMORY_CONFIG=/etc/assistant-memory/config.json
ENV ASSISTANT_MEMORY_BASE_DIR=/data/assistant
```

### 2. Create per-agent config

```json
{
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
}
```

### 3. Start the memory server

```typescript
import { createMemoryServiceFromConfig, startHttpServer } from "@paw/assistant-memory";

// Initialize from config file
const service = await createMemoryServiceFromConfig(
  process.env.ASSISTANT_MEMORY_CONFIG!,
  process.env.ASSISTANT_MEMORY_BASE_DIR!,
  { info: console.log, warn: console.warn, error: console.error }
);

service.start();

// Optional: start HTTP server
const stop = startHttpServer(service, { port: 7420, host: "0.0.0.0" });
```

Or use the CLI:

```bash
node dist/cli.js --config /etc/assistant-memory/config.json --base-dir /data/assistant
```

## API Reference

All endpoints return JSON. Base URL: `http://localhost:7420` (configurable).

### Health Check

```
GET /health
```

```json
{
  "status": "ok",
  "embedderOk": true,
  "dbOk": true,
  "entries": 42,
  "lastCheck": 1713900000000
}
```

### Status

```
GET /status
```

```json
{
  "entries": 42,
  "version": "1.0.0",
  "lastSync": 1713899000000
}
```

### Version

```
GET /version
```

```json
{ "version": "1.0.0" }
```

### Search

```
POST /search
```

```json
{ "query": "what are my preferences?", "limit": 5, "minScore": 0.3 }
```

```json
{
  "results": [
    {
      "entry": {
        "id": "uuid",
        "text": "I prefer dark mode",
        "vector": [...],
        "importance": 0.8,
        "category": "preference",
        "createdAt": 1713899000000
      },
      "score": 0.847
    }
  ],
  "meta": { "total": 1 }
}
```

### Add Memory

```
POST /add
```

```json
{
  "text": "I prefer dark mode",
  "importance": 0.8,
  "category": "preference",
  "tags": ["ui", "theme"]
}
```

```json
{ "entry": { "id": "uuid", "text": "...", "createdAt": 1713899000000 } }
```

### Update Memory

```
POST /update/:id
```

```json
{ "text": "updated text", "importance": 0.9 }
```

### Delete Memory

```
POST /delete
```

```json
{ "id": "uuid" }
```
or
```json
{ "query": "temporary note to delete" }
```

```json
{ "deleted": 1, "ids": ["uuid"] }
```

### Trigger Backup

```
POST /backup
```

```json
{ "ok": true }
```

## Module API

For direct integration without HTTP:

```typescript
import {
  createMemoryService,
  createLmStudioClient,
  createStore,
  createBackupService,
  loadConfig,
  resolveDataDir,
  resolveBackupDir,
} from "@paw/assistant-memory";

// Load config
const config = loadConfig("/path/to/config.json");

// Create components
const embeddings = createLmStudioClient({
  url: config.lmStudioUrl,
  model: config.lmStudioModel,
  logger: console,
});

const store = await createStore(embeddings, {
  dataDir: resolveDataDir("/data/assistant", config),
  logger: console,
});

const backupService = createBackupService(store, {
  backupDir: resolveBackupDir("/data/assistant", config),
  intervalMinutes: config.backupInterval,
  logger: console,
});

// Create and start service
const service = createMemoryService(embeddings, store, backupService, config, console);
service.start();

// Use it
const entry = await service.add("I prefer TypeScript", 0.9, "preference");
const results = await service.search("what language do I prefer", 5, 0.3);
await service.stop();
```

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | integer | 1 | Config schema version |
| `lmStudioUrl` | string | `http://192.168.64.1:1234/v1/embeddings` | LM Studio embeddings endpoint |
| `lmStudioModel` | string | `text-embedding-qwen3-embedding-4b` | Embedding model name |
| `backupInterval` | integer | 5 | Backup interval in minutes |
| `indexStrategy` | string | `on-change-plus-periodic` | Update strategy |
| `periodicInterval` | integer | 30 | Periodic sync interval in minutes |
| `autoRecall` | boolean | false | Inject relevant memories before agent starts |
| `autoCapture` | boolean | false | Auto-capture important info after agent ends |
| `captureMaxChars` | integer | 2000 | Max chars to capture per message |
| `backupDir` | string | `.memory/backups` | Directory for backups |
| `dataDir` | string | `.memory` | Base directory for memory data |

## Versioning (Option A — Pinned)

Marcus controls updates. Each agent has a `version` in `config.json`. Plugin checks version on startup. To update:

1. Marcus tests new version on staging
2. Marcus updates `config.json` version for each agent
3. Agents pick up changes on restart

## File Structure

```
assistant-memory/
├── src/
│   ├── index.ts      # Core: types, store, embeddings, backup, service
│   └── server.ts     # HTTP API server (optional)
├── tests/
│   └── memory.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- Node.js >= 20.0.0
- LM Studio running locally (or accessible at `lmStudioUrl`)
- File system write access for data and backup directories