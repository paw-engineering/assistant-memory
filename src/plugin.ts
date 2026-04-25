/**
 * OpenClaw IMemoryPlugin factory for assistant-memory.
 *
 * Usage:
 *   import { createPlugin } from '@dwg/assistant-memory';
 *   const plugin = await createPlugin({ agentId: 'programmer' });
 *   await plugin.start();
 */

import type { MemorySearchResult, MemoryItem } from "./types.js";
import type { MemoryPluginConfig } from "./config.js";

export type { MemoryPluginConfig };
export interface CreatePluginOptions { agentId: string; baseDir?: string; }

// ── Plugin Interface (IMemoryPlugin) ─────────────────────────────────────────

export interface MemoryPlugin {
  readonly name: string;
  readonly version: string;
  start(): Promise<void>;
  stop(): void;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<boolean>;
  getStats(): Promise<{ count: number; lastIndexed: number | null }>;
}

// ── Plugin Factory ───────────────────────────────────────────────────────────

export async function createPlugin(opts: CreatePluginOptions): Promise<MemoryPlugin> {
  const { agentId } = opts;

  const [
    { loadConfig },
    { initDb, upsertMemoryItem, getMemoryItem, deleteMemoryItem, getStats },
    { startWatcher, stopWatcher },
    versioning,
  ] = await Promise.all([
    import("./config.js"),
    import("./db.js"),
    import("./indexer.js"),
    import("./versioning.js"),
  ]);

  const config: MemoryPluginConfig & { indexUpdateIntervalMs?: number; watchDirs?: string[] } =
    loadConfig(agentId);

  versioning.logVersion();

  const dataDir = config.dataDir ?? `data/agents/${agentId}/memory`;
  const backupDir = `${dataDir}/backups`;

  // Init DB immediately so storage is available
  initDb();
  
  let watchInterval: NodeJS.Timeout | null = null;

  versioning.logVersion();

  const { version } = versioning.readVersion() ?? { version: "1.0.0" };

  return {
    name: "@dwg/assistant-memory",
    version,

    async start() {
      // Start file watcher if dirs configured
      if (config.watchDirs?.length) {
        startWatcher({ watchDirs: config.watchDirs });
      }
      console.log(`[assistant-memory] started v${version} for agent ${agentId}, dataDir=${dataDir}`);
    },

    stop() {
      stopWatcher();
      if (watchInterval) clearInterval(watchInterval);
      console.log(`[assistant-memory] stopped`);
    },

    async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
      const { hybridSearch } = await import("./search.js");
      return hybridSearch(query, limit);
    },

    async add(id: string, content: string, metadata?: Record<string, unknown>) {
      const now = Date.now();
      upsertMemoryItem({ id, content, metadata: metadata ?? {}, createdAt: now, updatedAt: now });
    },

    async remove(id: string): Promise<boolean> {
      return deleteMemoryItem(id);
    },

    async getStats() {
      const s = getStats();
      return { count: s.totalMemories + s.indexedFiles, lastIndexed: null };
    },
  };
}
