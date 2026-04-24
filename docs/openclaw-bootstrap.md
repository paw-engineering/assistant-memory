# OpenClaw Bootstrap Integration — assistant-memory

How to register and load the `assistant-memory` plugin in an OpenClaw workspace.

---

## Plugin Registration — Workspace Config

OpenClaw discovers plugins from the workspace config at:

```
{workspace}/config.json
```

Or any config path configured in your OpenClaw setup. Each plugin is listed under a
`plugins` array with its name, version, and entry point.

### Minimal workspace config

```json
{
  "plugins": [
    {
      "name": "assistant-memory",
      "version": "1.0.0",
      "entry": "node_modules/@dwg/assistant-memory/src/index.js"
    }
  ]
}
```

When OpenClaw starts, it iterates the `plugins` array and calls `createPlugin()` for
each plugin it knows how to load. Plugins that fail to start are logged as warnings but
do not crash the agent — see [Error Handling](#error-handling) below.

---

## Per-Agent Config File

Each agent that uses `assistant-memory` needs its own config file at:

```
{workspace}/config/agents/{agentId}/memory-plugin.json
```

### Full example — Virt's workspace

Marcus's workspace is at `~/.openclaw/workspace/`. For agent `virt`:

```
~/.openclaw/workspace/
├── config/
│   └── agents/
│       └── virt/
│           └── memory-plugin.json
```

```json
{
  "agentId": "virt",
  "lmStudioUrl": "http://192.168.64.1:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "embeddingDimension": 2560,
  "dataDir": "data/agents/virt/memory",
  "backupDir": "data/agents/virt/memory/backups",
  "backupIntervalMs": 300000,
  "maxBackups": 3,
  "indexUpdateIntervalMs": 30000
}
```

### All config fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `agentId` | Yes | — | Unique agent identifier. Must match the agent's own ID. |
| `lmStudioUrl` | No | `http://192.168.64.1:1234` | LM Studio server URL (include `/v1` if your server requires it) |
| `embeddingModel` | No | `text-embedding-qwen3-embedding-4b` | Embedding model name |
| `embeddingDimension` | No | `2560` | Embedding vector dimension (must match model) |
| `batchSize` | No | `32` | Max texts per LM Studio embedding batch |
| `dataDir` | No | `data/agents/{agentId}/memory` | Directory for SQLite DB and FAISS index |
| `backupDir` | No | `{dataDir}/backups` | Backup snapshots directory |
| `backupIntervalMs` | No | `300000` (5 min) | Backup snapshot interval in milliseconds |
| `maxBackups` | No | `10` | Max backup snapshots to retain |
| `indexUpdateIntervalMs` | No | `30000` | Periodic FAISS index rebuild interval in ms |

---

## How OpenClaw Loads the Plugin

1. **Discovery** — At startup, OpenClaw reads the workspace config and iterates the
   `plugins` array. It matches `name: "assistant-memory"` against installed packages.

2. **Import** — OpenClaw imports `@dwg/assistant-memory` and calls the exported
   `createPlugin()` with the agent's `agentId`.

3. **Init** — `createPlugin()` reads the per-agent config file, resolves defaults,
   wires up all internal layers (storage, embedder, FAISS, backup manager), and returns
   a `MemoryPlugin` instance.

4. **start()** — OpenClaw calls `plugin.start()`. The plugin rebuilds the FAISS index
   from existing memories and starts the periodic backup timer.

5. **Runtime** — OpenClaw uses the plugin via the `MemoryPlugin` interface: calling
   `search()`, `add()`, `remove()`, `getStats()` as the agent works.

6. **Shutdown** — OpenClaw calls `plugin.stop()` on graceful shutdown.

```
Config file: {workspace}/config/agents/{agentId}/memory-plugin.json
Data dir:    {workspace}/data/agents/{agentId}/memory/
```

---

## Error Handling

- **Startup failures** (missing config, LM Studio unreachable, corrupted DB) are logged
  as warnings — the plugin does not crash the agent. The plugin retries internally
  on next operation.
- **Search/add failures** propagate as exceptions — callers should handle them.
- The FAISS index rebuild on startup is wrapped in a try/catch so a stale/corrupt index
  does not prevent the plugin from starting.
- Backup failures are logged but do not stop the plugin.

---

## Data Layout

```
{workspace}/
├── config/
│   └── agents/
│       └── {agentId}/
│           └── memory-plugin.json   ← per-agent config
└── data/
    └── agents/
        └── {agentId}/
            └── memory/
                ├── index.faiss       ← FAISS vector index
                ├── memories.json     ← memory records (or SQLite)
                └── backups/
                    ├── backup-001.db
                    └── backup-002.db
```

`dataDir` in the config controls where everything lives. The `backups` subdirectory
is created automatically and holds snapshot files up to `maxBackups`.