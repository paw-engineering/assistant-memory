# assistant-memory — Installation Guide

Per-agent memory plugin: **SQLite** (memory store) + **FAISS** (vector index) + **LM Studio** (embeddings via OpenAI-compatible API).

---

## Environment 1: Virt's VM (macOS UTM)

### Prerequisites

- **LM Studio** running at `http://192.168.64.1:1234`
- Model loaded: `text-embedding-qwen3-embedding-4b` (or any model that outputs 2560-dim vectors)
- Verify LM Studio is up:
  ```bash
  curl http://192.168.64.1:1234/v1/models
  ```
  You should see your model listed.

### 1. Clone / pull the repo

```bash
cd ~/projects/assistant-memory
git pull  # if already cloned
# or: git clone <url> ~/projects/assistant-memory
```

### 2. Install dependencies

```bash
cd ~/projects/assistant-memory
npm install
```

> `faiss-node` (a native addon) may trigger a rebuild — give it a moment.

### 3. Create per-agent config

```bash
mkdir -p ~/projects/assistant-memory/config/agents/virt
```

Create `~/projects/assistant-memory/config/agents/virt/memory-plugin.json`:

```json
{
  "agentId": "virt",
  "lmStudioUrl": "http://192.168.64.1:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "dataDir": "data/agents/virt/memory"
}
```

### 4. Create the data directory

```bash
mkdir -p ~/projects/assistant-memory/data/agents/virt/memory
```

### 5. Verify the plugin loads

**Quick smoke test — check config parsing + LM Studio connectivity:**

```bash
cd ~/projects/assistant-memory
node --import tsx -e "
import { loadConfig } from './src/config.js';
const cfg = loadConfig('./config/agents/virt/memory-plugin.json');
console.log('agentId:', cfg.agentId);
console.log('lmStudioUrl:', cfg.lmStudioUrl);
console.log('embeddingModel:', cfg.embeddingModel);
console.log('embeddingDimension:', cfg.embeddingDimension);
"
```

**Full plugin start (runs the memory store):**

```bash
cd ~/projects/assistant-memory
npm run start -- --config config/agents/virt/memory-plugin.json
```

Press `Ctrl+C` to stop. If it starts without errors, you're good.

**Run the test suite:**

```bash
npm test
```

---

## Environment 2: Docker Assistant Images

The plugin is bundled into the Docker image at **`/app/plugins/assistant-memory/`**.

### Prerequisites

- LM Studio must be reachable from inside the container via `http://host.docker.internal:1234`
- Model: `text-embedding-qwen3-embedding-4b`

### Config — bind-mounted per-agent config

Create the config on the **host** (your Mac):

```bash
# on host — choose a unique agentId per container instance
mkdir -p /path/to/your/project/config/agents/<agentId>
```

Create `/path/to/your/project/config/agents/<agentId>/memory-plugin.json`:

```json
{
  "agentId": "<agentId>",
  "lmStudioUrl": "http://host.docker.internal:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "dataDir": "/app/data/agents/<agentId>/memory"
}
```

### Docker run — volume mounts

```bash
docker run -d \
  --name assistant \
  -v /path/to/your/project/config/agents/<agentId>:/app/config/agents/<agentId>:ro \
  -v assistant-memory-data:/app/data \
  -e AGENT_MEMORY_CONFIG=/app/config/agents/<agentId>/memory-plugin.json \
  -e AGENT_ID=<agentId> \
  assistant-image:latest
```

**What the volumes do:**

| Volume | Inside container | Purpose |
|--------|-----------------|---------|
| `config/agents/<agentId>/memory-plugin.json` | `/app/config/agents/<agentId>/memory-plugin.json` | Read-only per-agent config |
| `assistant-memory-data` (named volume) | `/app/data` | Persists SQLite DB + FAISS index across restarts |

### Verify inside a running container

```bash
docker exec assistant curl http://host.docker.internal:1234/v1/models
```

```bash
docker exec assistant node --import tsx -e "
import { loadConfig } from '/app/plugins/assistant-memory/src/config.js';
const cfg = loadConfig('/app/config/agents/<agentId>/memory-plugin.json');
console.log('agentId:', cfg.agentId);
console.log('lmStudioUrl:', cfg.lmStudioUrl);
console.log('embeddingDimension:', cfg.embeddingDimension);
"
```

Expected output:

```
agentId: <agentId>
lmStudioUrl: http://host.docker.internal:1234
embeddingDimension: 2560
```

### Data persistence

| File | Location inside container | Persisted via |
|------|--------------------------|---------------|
| Memory entries (SQLite) | `/app/data/agents/<agentId>/memory/memory.db` | named volume `assistant-memory-data` |
| FAISS index | `/app/data/agents/<agentId>/memory/index.faiss` | named volume `assistant-memory-data` |
| Backups | `/app/data/agents/<agentId>/memory/backups/` | named volume `assistant-memory-data` |

---

## Quick Reference

| | VM (macOS UTM) | Docker |
|---|---|---|
| LM Studio URL | `http://192.168.64.1:1234` | `http://host.docker.internal:1234` |
| Config path | `~/projects/assistant-memory/config/agents/{agentId}/memory-plugin.json` | Bind-mounted to `/app/config/agents/{agentId}/memory-plugin.json` |
| Data path | `~/projects/assistant-memory/data/agents/{agentId}/memory/` | `/app/data/agents/{agentId}/memory/` |
| Start command | `npm run start` | `node --import tsx /app/plugins/assistant-memory/src/plugin.ts` |
| Config env var | (file path passed via `--config`) | `AGENT_MEMORY_CONFIG` |

---

## Troubleshooting

**`Failed to connect to LM Studio`**
- Check LM Studio is running and the model is loaded
- VM: `curl http://192.168.64.1:1234/v1/embeddings` — you should get a JSON error (server is up, just need a valid request body)
- Docker: `docker exec <container> curl http://host.docker.internal:1234/v1/models`

**`faiss-node` build errors**
- Requires Python + a C++ compiler for native addon rebuilds
- On macOS: `xcode-select --install` then retry `npm install`

**Config validation errors**
- `agentId` is required — every config must have it
- `lmStudioUrl` must be a valid URI
- Run `npm run typecheck` in the repo to surface TypeScript errors
