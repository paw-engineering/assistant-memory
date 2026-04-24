/**
 * Per-Agent Memory Plugin — Plugin Entry Point
 *
 * Exposes the plugin to the DWG Assistant host via createPlugin().
 * The host calls initPlugin() to start the plugin and obtain the plugin API.
 */

import { loadConfig, validateConfig, resolveDataDir } from "./config.js";
import type { MemoryPluginConfig } from "./config.js";
import { logVersion } from "./versioning.js";

export type { MemoryPluginConfig };

export interface MemorySearchResult {
  id: string;
  text: string;
  score: number;
  timestamp: number;
  tags: string[];
  source?: string;
}

export interface MemoryPluginEvents {
  onMemoryAdded?: (item: { id: string; text: string; tags: string[] }) => void;
  onMemoryForgotten?: (id: string) => void;
  onIndexUpdated?: () => void;
  onBackupCompleted?: (timestamp: number) => void;
}

export interface MemoryPlugin {
  /** Unique agent identifier */
  agentId: string;
  /** Add a new memory. Embeds text, stores it, updates the index. */
  add(text: string, tags?: string[], source?: string): Promise<{ id: string }>;
  /** Search memories by semantic similarity. Returns top-k results. */
  search(query: string, k?: number): Promise<MemorySearchResult[]>;
  /** Retrieve a specific memory by id. */
  remember(id: string): { id: string; text: string; timestamp: number; tags: string[]; source?: string } | undefined;
  /** Delete a memory by id. */
  forget(id: string): Promise<boolean>;
  /** Get recent memories, newest first. */
  getRecent(limit?: number): Array<{ id: string; text: string; timestamp: number; tags: string[] }>;
  /** Get memories by tags. */
  getByTags(tags: string[], matchAny?: boolean): Array<{ id: string; text: string; timestamp: number; tags: string[] }>;
  /** Get memory statistics. */
  stats(): { totalMemories: number; indexSize: number };
  /** Trigger an immediate backup snapshot. */
  backupNow(): void;
  /** Shutdown the plugin, stopping timers and saving state. */
  shutdown(): void;
}

type MemoryManager = {
  add(text: string, tags: string[], source?: string): Promise<import("./storage.js").MemoryItem>;
  search(query: string, k: number): Promise<import("./memory.js").MemorySearchResult[]>;
  remember(id: string): import("./storage.js").MemoryItem | undefined;
  forget(id: string): boolean;
  getRecent(limit: number): import("./storage.js").MemoryItem[];
  getByTags(tags: string[], matchAny: boolean): import("./storage.js").MemoryItem[];
  rebuildIndex(): void;
  stats(): { totalMemories: number; indexSize: number; storageCount: number };
  startPeriodicUpdate(): void;
  stopPeriodicUpdate(): void;
  backupNow(): void;
  shutdown(): void;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let managerInstance: MemoryManager | null = null;

async function createManager(
  config: MemoryPluginConfig,
  dataDir: string,
  backupDir: string
): Promise<MemoryManager> {
  // Dynamic imports to avoid circular deps
  const { MemoryManager } = await import("./memory.js");
  const { MemoryStorage } = await import("./storage.js");
  const { FaissIndex } = await import("./faiss.js");
  const { Embedder } = await import("./embedder.js");
  const { BackupManager } = await import("./backup.js");

  const storage = new MemoryStorage(dataDir);
  const index = new FaissIndex(config.embeddingDimension!, dataDir);
  index.load();

  const embedder = new Embedder({
    lmStudioUrl: config.lmStudioUrl!,
    embeddingModel: config.embeddingModel!,
    embeddingDimension: config.embeddingDimension!,
    batchSize: config.batchSize,
  });

  const backup = new BackupManager(
    dataDir,
    backupDir,
    config.maxBackups,
    config.backupIntervalMs
  );
  backup.start();

  const manager = new MemoryManager(
    storage,
    index,
    embedder,
    backup,
    config.indexUpdateIntervalMs ?? 30_000
  );

  manager.startPeriodicUpdate();
  return manager;
}

/**
 * Initialize the memory plugin for a specific agent.
 *
 * @param agentId - Unique agent identifier
 * @param baseDir - Optional base directory for config resolution (defaults to cwd)
 * @param events - Optional event listeners
 */
export async function initPlugin(
  agentId: string,
  baseDir?: string,
  events?: MemoryPluginEvents
): Promise<MemoryPlugin> {
  logVersion();

  const config = loadConfig(agentId, baseDir);
  validateConfig(config);

  const dataDir = resolveDataDir(config);
  const backupDir = `${dataDir}-backups`;

  const manager = await createManager(config, dataDir, backupDir);
  managerInstance = manager;

  return {
    agentId: config.agentId,

    async add(text: string, tags: string[] = [], source?: string) {
      const item = await manager.add(text, tags, source);
      events?.onMemoryAdded?.({ id: item.id, text: item.text, tags: item.tags });
      return { id: item.id };
    },

    async search(query: string, k = 5) {
      return manager.search(query, k);
    },

    remember(id: string) {
      return manager.remember(id);
    },

    async forget(id: string) {
      const result = manager.forget(id);
      if (result) events?.onMemoryForgotten?.(id);
      return result;
    },

    getRecent(limit = 10) {
      return manager.getRecent(limit).map((item) => ({
        id: item.id,
        text: item.text,
        timestamp: item.timestamp,
        tags: item.tags,
      }));
    },

    getByTags(tags: string[], matchAny = true) {
      return manager.getByTags(tags, matchAny).map((item) => ({
        id: item.id,
        text: item.text,
        timestamp: item.timestamp,
        tags: item.tags,
      }));
    },

    stats() {
      const s = manager.stats();
      return { totalMemories: s.totalMemories, indexSize: s.indexSize };
    },

    backupNow() {
      manager.backupNow();
      events?.onBackupCompleted?.(Date.now());
    },

    shutdown() {
      manager.shutdown();
      managerInstance = null;
    },
  };
}

/**
 * Factory for creating a MemoryPlugin instance (used by the host).
 */
export async function createPlugin(
  agentId: string,
  baseDir?: string,
  events?: MemoryPluginEvents
): Promise<MemoryPlugin> {
  return initPlugin(agentId, baseDir, events);
}
