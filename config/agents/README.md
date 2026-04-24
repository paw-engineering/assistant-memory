# Per-Agent Configuration

Each DWG Assistant gets its own config injected at deploy time.

## Directory Structure

```
config/
└── agents/
    └── {agentId}/
        └── memory-plugin.json   ← injected by deployment system
```

## Example: `config/agents/dwg-assistant-1/memory-plugin.json`

```json
{
  "agentId": "dwg-assistant-1",
  "persona": "Code Assistant",
  "systemPrompt": "You are a helpful coding assistant. Always explain your reasoning.",
  "lmStudioUrl": "http://192.168.64.1:1234",
  "embeddingModel": "text-embedding-qwen3-embedding-4b",
  "dataDir": "data/agents/dwg-assistant-1/memory",
  "backupDir": "data/agents/dwg-assistant-1/memory/backups",
  "backupInterval": 300,
  "maxBackups": 3
}
```

## Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `agentId` | Yes | — | Unique agent identifier |
| `persona` | Yes | — | Agent persona name |
| `systemPrompt` | Yes | — | Agent system prompt |
| `lmStudioUrl` | No | `http://192.168.64.1:1234` | LM Studio endpoint |
| `embeddingModel` | No | `text-embedding-qwen3-embedding-4b` | Embedding model |
| `dataDir` | No | `data/agents/{agentId}/memory` | Memory data directory |
| `backupDir` | No | `{dataDir}/backups` | Backup directory |
| `backupInterval` | No | `300` | Backup interval in seconds (5 min) |
| `maxBackups` | No | `3` | Max backups to retain |
| `version` | No | from `../../src/VERSION` | Plugin version (read-only, logged at startup) |

## Deployment

Marcus's deployment system reads `config/agents/{agentId}/memory-plugin.json`
and sets the `AGENT_MEMORY_CONFIG` environment variable before starting the agent:

```bash
export AGENT_MEMORY_CONFIG="/path/to/config/agents/dwg-assistant-1/memory-plugin.json"
export AGENT_ID="dwg-assistant-1"
node --import tsx src/plugin.ts
```
