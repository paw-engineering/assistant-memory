/**
 * OpenClaw IMemoryPlugin factory for assistant-memory.
 *
 * Usage:
 *   import { createPlugin } from '@dwg/assistant-memory';
 *   const plugin = await createPlugin({ agentId: 'programmer' });
 *   await plugin.start();
 */
// ── Plugin Factory ───────────────────────────────────────────────────────────
export async function createPlugin(opts) {
    const { agentId } = opts;
    const [{ loadConfig }, { initDb, upsertMemoryItem, getMemoryItem, deleteMemoryItem, getStats }, { startWatcher, stopWatcher }, versioning,] = await Promise.all([
        import("./config.js"),
        import("./db.js"),
        import("./indexer.js"),
        import("./versioning.js"),
    ]);
    const config = loadConfig(agentId);
    versioning.logVersion();
    const dataDir = config.dataDir ?? `data/agents/${agentId}/memory`;
    const backupDir = `${dataDir}/backups`;
    // Init DB immediately so storage is available
    initDb();
    let watchInterval = null;
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
            if (watchInterval)
                clearInterval(watchInterval);
            console.log(`[assistant-memory] stopped`);
        },
        async search(query, limit = 5) {
            const { hybridSearch } = await import("./search.js");
            return hybridSearch(query, limit);
        },
        async add(id, content, metadata) {
            const now = Date.now();
            upsertMemoryItem({ id, content, metadata: metadata ?? {}, createdAt: now, updatedAt: now });
        },
        async remove(id) {
            return deleteMemoryItem(id);
        },
        async getStats() {
            const s = getStats();
            return { count: s.totalMemories + s.indexedFiles, lastIndexed: null };
        },
    };
}
//# sourceMappingURL=plugin.js.map