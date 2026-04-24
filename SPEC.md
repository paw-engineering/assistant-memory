# Memory System — SPEC.md

**Project:** OpenClaw Memory Plugin (working name: `claw-memory`)
**Status:** Approved — implementation can begin.
**Date:** 2026-04-23
**Authors:** Virt + Lobs (collaborative design)

---

## Problem Statement

Current memory systems have two broken paths:

1. **lobs-memory (Lobs):** SQLite DB corruption, no real-time sync, health endpoint lies about query health
2. **Virt's `memory_search`:** Non-existent — relies on reading files directly, no semantic search

Key constraint from Marcus: **per-agent index only, no multi-agent shared access.** DWG Assistants are private and portable — they cannot share a common index. Each agent maintains its own local index. This changes the architecture significantly from a shared service model.

---

## Design Goals

1. **Per-agent isolation** — each agent (Virt, each DWG Assistant) has its own index. No cross-agent read/write. Privacy + portability.
2. **Reliability** — WAL mode SQLite with backup on write; graceful degradation when embeddings unavailable
3. **Real-time sync** — file watcher triggers re-index on change, no manual rebuilds
4. **Observable** — health endpoint that reflects actual query health, not just "server alive"
5. **Citations** — every result points to source file + line range, verifiable
6. **Runs locally in VM/container** — DWG Assistants run in containers; plugin must be script-run, no external service dependency

---

## Architecture: Per-Agent Plugin Model

**No shared service.** Each agent runs `claw-memory` as a local plugin process. Plugin runs in the same VM/container as the agent. All agents are isolated.

```
┌─────────────────────────────────────────────────────┐
│              Agent's VM / Container                 │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ File Watcher│  │  Indexer     │  │  Search   │  │
│  │ (chokidar)  │→ │  (chunk +    │  │  API      │  │
│  │             │  │  embed)      │  │  /search  │  │
│  └─────────────┘  └──────────────┘  └───────────┘  │
│         │                 │                │       │
│         ↓                 ↓                ↓       │
│  ┌──────────────────────────────────────────────┐  │
│  │     SQLite (WAL mode) — agent's local index   │  │
│  │  vectors + bm25 + metadata + citations        │  │
│  └──────────────────────────────────────────────┘  │
│                       │                            │
│                 ┌──────┴──────┐                   │
│                 │ backup.sh    │                   │
│                 │ (on-write)   │                   │
│                 └──────────────┘                   │
└─────────────────────────────────────────────────────┘
         ↑ plugin interface (memory_search tool)
         ↓
    ┌─────────┐
    │  Agent  │ ← Virt, or DWG Assistant
    └─────────┘
```

**Components per agent:**
- **File watcher:** monitors configured directories, triggers re-index on create/modify/delete
- **Indexer:** chunks docs, generates embeddings (configurable: OpenAI, Local LLM, or Ollama), stores in local SQLite
- **Search API:** `POST /search` — hybrid BM25 + vector similarity, returns results with citations
- **Health endpoint:** `GET /health` — actually queries the DB and returns status
- **Backup script:** on-write snapshot for corrupt recovery

**API (per agent, localhost only):**

```
POST /search
Body: {"query": "...", "limit": 5}
Response: {"results": [{"path", "startLine", "endLine", "score", "snippet", "source"}, ...], "meta": {"total", "searchMs"}}

GET /health
Response: {"status": "ok|degraded|down", "dbOk": bool, "embedderOk": bool, "lastIndex": "timestamp"}

POST /index
Body: {"paths": ["file1.md", "file2.md"]}  — manual re-index trigger

GET /status
Response: {"indexedDocs": int, "lastSync": "timestamp", "collections": [...]}
```

**Graceful degradation:** If embedding service is down, search falls back to BM25-only mode. Health reflects this as "degraded" not "ok".

---

## OpenClaw Plugin Interface

Each agent gets its own `claw-memory` plugin instance:

```javascript
// Plugin config per agent
{
  "watch": [
    "memory/",        // daily logs, MEMORY.md, learnings.md
    "workspace/",    // SOUL.md, USER.md, AGENTS.md, project files
  ],
  "embedder": "openai",  // or "ollama", "local"
  "embedderUrl": "...",  // endpoint for embedding service
  "indexPath": "./memory-index/",  // local SQLite + vectors
  "backupDir": "./backups/",
}
```

Plugin exposes to agent:
- `memory_search(query, limit?)` — tool callable from agent context
- `memory_index(paths?)` — re-index specific paths or all watched dirs
- `memory_health()` — check if index is operational

---

## What Gets Indexed (per agent)

Default collections (configurable per agent):
- `memory/` — daily logs, MEMORY.md, learnings.md
- `workspace/` — SOUL.md, USER.md, AGENTS.md, workspace files
- Agent-specific project directories

DWG Assistants: each instance indexes only its own files. No visibility into other assistants' indices.

---

## Not in Scope (v1)

- Cross-agent shared index — explicitly not allowed per Marcus
- Multi-machine / distributed deployment
- Per-agent ACLs (no cross-agent access to begin with)
- Custom embedding models (use configured provider)
- Full-text search UI (API only, agents consume)

---

## Why Per-Agent Over Shared

1. **Privacy:** DWG Assistants are Marcus's private tools. Shared infrastructure means one assistant could query another's memory.
2. **Portability:** Each assistant can be spun up/down without affecting others. No coordination overhead.
3. **Simplicity:** No access control, no shared state management. Each agent is fully self-contained.
4. **Failure isolation:** One agent's index corruption doesn't affect any other agent.

---

## Implementation Steps (once approved)

1. Create `claw-memory` as an OpenClaw plugin (per-agent installation)
2. SQLite setup with WAL mode + backup script (per-agent data directory)
3. File watcher (chokidar) monitoring configured dirs
4. Embedding pipeline (configurable provider — OpenAI default, Ollama for local)
5. Search endpoint with hybrid BM25 + vector scoring
6. Health endpoint that actually hits the DB
7. OpenClaw plugin registration + tool bindings (`memory_search`, `memory_index`, `memory_health`)
8. Test: Virt indexes its memory, verify `memory_search` returns results
9. Test: corrupt recovery via backup

**Time estimate:** 2–3 days for working v1.

---

## Implementation Notes (from Lobs review)

**Embedding provider (#1):** Local LM Studio at `http://192.168.64.1:1234/v1/embeddings` with model `text-embedding-qwen3-embedding-4b` (OpenAI-compatible API). All agents use same local instance. No OpenAI dependency.

**Bootstrap (#4):** Shared plugin code, per-agent config. One codebase, each agent gets its own `config.json` pointing at its own SQLite. Simpler to maintain, easier to update.

**Backup frequency (#3):** 5-min interval — Marcus confirmed 2026-04-24.

**Index update strategy (#2):** On-change + periodic fallback (safest). File watcher handles changes; periodic scan catches any drift.

**Versioning strategy:** Marcus selected **Option A (pinned)**. Agent owner controls when updates are applied — nothing ships to agents without explicit approval.

---


## Resolution Log

~~1. **Embedding provider:**~~ ✅ Resolved — Local LM Studio at `http://192.168.64.1:1234/v1/embeddings` with model `text-embedding-qwen3-embedding-4b`.
~~2. **Index update strategy:**~~ ✅ Resolved — on-change + periodic fallback. Safe default, avoids stale indexes without write hammering.
~~3. **Backup frequency:**~~ ✅ Resolved — **5-min interval** (Marcus confirmed 2026-04-24).
~~4. **DWG Assistant bootstrap:**~~ ✅ Resolved — shared plugin code, per-agent config.
~~5. **Data migration:**~~ ✅ Resolved — skip, start fresh. Nothing worth migrating from broken lobs-memory.
~~6. **Versioning strategy:**~~ ✅ Resolved — **Option A (pinned)**. Marcus controls update cadence per agent.

