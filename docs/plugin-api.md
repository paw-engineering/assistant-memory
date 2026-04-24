# Plugin API Reference — @dwg/assistant-memory

Full API documentation for the `assistant-memory` plugin.

---

## MemoryPlugin Interface

The primary interface OpenClaw interacts with.

```typescript
interface MemoryPlugin {
  readonly name: string;        // "assistant-memory"
  readonly version: string;     // e.g. "1.0.0"
  start(): Promise<void>;
  stop(): void;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<boolean>;
  getStats(): Promise<{ count: number; lastIndexed: number | null }>;
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Always `"assistant-memory"`. Used by OpenClaw to identify the plugin. |
| `version` | `string` | Plugin version from `VERSION` file (e.g. `"1.0.0"`). Logged at startup. |

### `start()`

```typescript
start(): Promise<void>
```

Initialises the plugin. Called by OpenClaw after `createPlugin()` returns.

**Actions:**
1. Rebuilds the FAISS index from all existing memories in storage
2. Starts the periodic backup timer
3. Starts the periodic FAISS index rebuild timer (fallback for any missed embeddings)

**Errors:** Non-fatal. Startup failures are caught and logged as warnings — the plugin
continues running.

### `stop()`

```typescript
stop(): void
```

Graceful shutdown. Called when OpenClaw is stopping the agent.

**Actions:**
1. Stops the periodic index rebuild timer
2. Stops the backup scheduler
3. Saves the FAISS index to disk

**Errors:** Caught and logged. Never throws.

### `search(query, limit?)`

```typescript
search(query: string, limit?: number): Promise<MemorySearchResult[]>
```

Search memory by semantic similarity. Uses the FAISS index to find the `limit`
most similar memories to the query text.

**Parameters:**
- `query` — Search text. Embedded via LM Studio, then compared against stored vectors.
- `limit` — Max results to return. Default: `5`.

**Returns:** `Promise<MemorySearchResult[]>`

```typescript
interface MemorySearchResult {
  id: string;
  text: string;
  score: number;       // cosine similarity, 0–1
  timestamp: number;   // Unix ms
  tags: string[];
  source?: string;
}
```

**Errors:** Throws if LM Studio is unreachable or the FAISS index is corrupted.

### `add(id, content, metadata?)`

```typescript
add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>
```

Add a new memory. The `id` is the caller's chosen identifier for this memory.
The content is embedded and stored.

**Parameters:**
- `id` — Unique identifier. Stored as `id:{id}` internally. Must be stable — used
  for future `remove()` calls.
- `content` — The memory text to embed and store.
- `metadata` — Optional. Currently ignored by the plugin but accepted for future use.

**Actions:**
1. Embed `content` via LM Studio
2. Persist to storage (SQLite + FTS5)
3. Add to FAISS index immediately
4. Save FAISS index to disk

**Errors:** Throws if embed or storage write fails.

### `remove(id)`

```typescript
remove(id: string): Promise<boolean>
```

Delete a memory by its `id`. Triggers a full FAISS index rebuild.

**Parameters:**
- `id` — The identifier passed to `add()`.

**Returns:** `Promise<boolean>` — `true` if the memory was found and deleted,
`false` if no memory with that `id` existed.

**Errors:** None. Missing IDs are not errors.

### `getStats()`

```typescript
getStats(): Promise<{ count: number; lastIndexed: number | null }>
```

Returns memory store statistics.

**Returns:**
```typescript
{
  count: number;           // total memories in storage
  lastIndexed: number | null;  // always null (not tracked)
}
```

---

## createPlugin Factory

```typescript
async function createPlugin(opts: CreatePluginOptions): Promise<MemoryPlugin>
```

Creates and returns a configured `MemoryPlugin` instance. Does not call `start()` —
OpenClaw calls `start()` separately after this returns.

### CreatePluginOptions

```typescript
interface CreatePluginOptions {
  /** Agent identifier. Used to locate the per-agent config file. */
  agentId: string;
  /** Workspace root directory. Default: process.cwd() */
  baseDir?: string;
}
```

**Config resolution:**
1. Resolves config file at `{baseDir}/config/agents/{agentId}/memory-plugin.json`
2. If the file exists, parses it and merges over defaults
3. If absent, uses hard-coded defaults (LM Studio at `http://192.168.64.1:1234`,
   model `text-embedding-qwen3-embedding-4b`, dimension `2560`)

---

## Config File Schema

Path: `{workspace}/config/agents/{agentId}/memory-plugin.json`

All fields are optional except `agentId`.

```json
{
  "agentId": "virt",
  "lmStudioUrl": "http://192.168.64.1:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "embeddingDimension": 2560,
  "batchSize": 32,
  "dataDir": "data/agents/virt/memory",
  "backupDir": "data/agents/virt/memory/backups",
  "backupIntervalMs": 300000,
  "maxBackups": 10,
  "indexUpdateIntervalMs": 30000
}
```

| Field | Type | Default | Constraints |
|-------|------|---------|-------------|
| `agentId` | `string` | — | Required. Non-empty. |
| `lmStudioUrl` | `string` | `http://192.168.64.1:1234` | Valid URI |
| `embeddingModel` | `string` | `text-embedding-qwen3-embedding-4b` | Any non-empty string |
| `embeddingDimension` | `number` | `2560` | Positive integer |
| `batchSize` | `number` | `32` | 1–256 |
| `dataDir` | `string` | `data/agents/{agentId}/memory` | Valid path |
| `backupDir` | `string` | `{dataDir}/backups` | Valid path |
| `backupIntervalMs` | `number` | `300000` | ≥ 60000 |
| `maxBackups` | `number` | `10` | ≥ 1 |
| `indexUpdateIntervalMs` | `number` | `30000` | ≥ 5000 |

---

## Events

The plugin does **not** emit events. All state changes (add, remove, backup)
happen synchronously within method calls or via internal timers.

If you need to observe plugin activity, wrap the plugin methods in your own
observer layer, or check `getStats()` periodically.

---

## Error Handling Summary

| Operation | Failure mode |
|-----------|---------------|
| `createPlugin()` | Throws if config file is present but malformed. Uses defaults if absent. |
| `start()` | Non-fatal. Logs warning, continues. |
| `search()` | Throws if LM Studio unreachable or index corrupted. |
| `add()` | Throws if embed or storage write fails. |
| `remove()` | Non-fatal. Returns `false` if not found. |
| `stop()` | Non-fatal. Errors caught and logged. |
| `getStats()` | Never throws. |

The backup scheduler and periodic index rebuild also catch their own errors
internally and log them without affecting the plugin.

---

## Exports

```typescript
// Main entry
export { createPlugin } from "./plugin.js";
export type { MemoryPlugin, CreatePluginOptions } from "./plugin.js";

// Config
export type { MemoryPluginConfig } from "./config.js";
export { loadConfig } from "./config.js";

// Storage (for advanced use — not needed for normal integration)
export { MemoryStorage } from "./storage.js";
export type { MemoryItem } from "./storage.js";
```

Import from `@dwg/assistant-memory` or from the package's source entry point
`src/index.js` depending on your workspace setup.