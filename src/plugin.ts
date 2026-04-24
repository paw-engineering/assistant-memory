/**
 * OpenClaw IMemoryPlugin factory for assistant-memory.
 *
 * Usage:
 *   import { createPlugin } from '@dwg/assistant-memory';
 *   const plugin = await createPlugin({ agentId: 'programmer' });
 *   await plugin.start();
 *
 * Bootstrap: shared plugin code, per-agent config at
 *   {workspace}/config/agents/{agentId}/memory-plugin.json
 *
 * Versioning: Option A pinned — config/agents/{agentId}/config.json
 *   must contain plugins.assistant-memory.version matching the running plugin version.
 */

import { createRequire } from "node:module";
import { MemoryStorage } from "./storage.js";
import { FtsIndex } from "./index.js";
import { LMStudioEmbedder } from "./embedder.js";
import { BackupManager } from "./backup.js";
import { MemoryManager } from "./memory.js";
import { loadConfig } from "./config.js";
import { validateVersion } from "./versioning.js";
import type { SearchResult } from "./memory.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Plugin interface (OpenClaw IMemoryPlugin)
// ---------------------------------------------------------------------------

export interface MemoryPlugin {
  /** Plugin name — always "assistant-memory" */
  name: string;
  /** Plugin semantic version */
  version: string;
  /** Start the plugin (index existing memories, start watcher & backup) */
  start(): Promise<void>;
  /** Stop the plugin cleanly (close watcher, stop backup, close DB) */
  stop(): void;
  /** Full-text search — returns ranked results with content */
  search(query: string, limit?: number): Promise<SearchResult[]>;
  /** Add or update a memory entry */
  add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  /** Remove a memory entry by id. Returns true if deleted. */
  remove(id: string): Promise<boolean>;
  /** Get memory count and last indexed timestamp */
  getStats(): Promise<{ count: number; lastIndexed: number | null }>;
}

// ---------------------------------------------------------------------------
// VERSION — read from the plugin package's own VERSION file at runtime
// ---------------------------------------------------------------------------

function readPluginVersion(): string {
  try {
    const { readFileSync, existsSync } = require("node:fs");
    const { dirname, resolve } = require("node:path");
    const { fileURLToPath } = require("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const versionFile = resolve(dir, "VERSION");
    if (!existsSync(versionFile)) return "unknown";
    return readFileSync(versionFile, "utf-8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export interface CreatePluginOptions {
  /** Agent id — determines config file location and data directory */
  agentId: string;
  /** Workspace root (defaults to cwd()) */
  baseDir?: string;
}

/**
 * Create and configure a MemoryPlugin for a specific agent.
 *
 * Steps:
 *   1. Load per-agent config from config/agents/{agentId}/memory-plugin.json
 *   2. Validate version pinning (Option A — blocks startup if version mismatch)
 *   3. Initialise storage, index, embedder, backup
 *   4. Return plugin ready for start()
 */
export async function createPlugin(opts: CreatePluginOptions): Promise<MemoryPlugin> {
  const { agentId, baseDir } = opts;

  // 1. Load per-agent config
  const config = loadConfig(agentId, baseDir);

  // 2. Version validation — Option A pinned (blocks startup on mismatch)
  try {
    validateVersion(agentId);
  } catch (err) {
    throw new Error(`[assistant-memory] Version check failed: ${err}`);
  }

  // 3. Initialise layers
  const storage = new MemoryStorage(config.dataDir);
  const index = new FtsIndex(storage);
  const embedder = new LMStudioEmbedder({
    baseUrl: config.lmStudioUrl,
    model: config.lmStudioModel,
    dimension: config.embeddingDimension,
  });
  const backupManager = new BackupManager(storage, {
    dataDir: config.dataDir,
    intervalMin: config.backupIntervalMin,
    maxBackups: config.maxWalBackups,
  });
  const manager = new MemoryManager(storage, index, embedder, config);

  const version = readPluginVersion();

  const plugin: MemoryPlugin = {
    name: "assistant-memory",
    version,

    async start() {
      backupManager.start();
      await manager.start();
      console.log(`[assistant-memory] started v${version} for agent ${agentId}`);
    },

    stop() {
      manager.stop();
      backupManager.stop();
      storage.close();
      console.log(`[assistant-memory] stopped`);
    },

    async search(query, limit) {
      return manager.search(query, limit);
    },

    async add(id, content, metadata) {
      return manager.add(id, content, metadata);
    },

    async remove(id) {
      return manager.remove(id);
    },

    async getStats() {
      return manager.getStats();
    },
  };

  return plugin;
}