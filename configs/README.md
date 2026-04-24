# Per-Agent Memory Configs

This directory contains per-agent configuration for the DWG Assistants memory plugin system.

## Structure

```
configs/
└── {agent-name}/
    ├── manifest.json   # Agent-specific version pinning
    └── config.json     # Runtime configuration
```

## How it works

1. Each DWG Assistant (e.g., `programmer`, ` librarian`) has its own config directory
2. Agents bootstrap via shared plugin code (`../plugin/`) + their own per-agent config
3. Version pinning is controlled by Marcus via the version endpoint

## Adding a new agent

1. Create `configs/{agent-name}/manifest.json` — points to Marcus's version endpoint
2. Create `configs/{agent-name}/config.json` — agent-specific settings

## Files

- `programmer/` — Example config for the programmer agent