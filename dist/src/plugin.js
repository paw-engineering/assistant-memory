/**
 * OpenClaw IMemoryPlugin factory for assistant-memory.
 *
 * Usage:
 *   import { createPlugin } from '@dwg/assistant-memory';
 *   const plugin = await createPlugin({ agentId: 'programmer' });
 *   await plugin.start();
 */
export async function createPlugin(opts) {
    const { agentId } = opts;
    const [{ MemoryStorage }, { FaissIndex }, { Embedder }, { BackupManager }, { MemoryManager }, configModule, versioningModule] = await Promise.all([
        import("./storage.js"),
        import("./faiss.js"),
        import("./embedder.js"),
        import("./backup.js"),
        import("./memory.js"),
        import("./config.js"),
        import("./versioning.js"),
    ]);
    const { loadConfig } = configModule;
    const { logVersion, readVersion } = versioningModule;
    // Load per-agent config
    const config = loadConfig(agentId);
    logVersion();
    const resolvedDataDir = config.dataDir ?? `data/agents/${agentId}/memory`;
    const backupDir = `${resolvedDataDir}/backups`;
    const indexUpdateIntervalMs = config.indexUpdateIntervalMs ?? 30_000;
    // Initialise layers
    const storage = new MemoryStorage(resolvedDataDir);
    const embedder = new Embedder({
        lmStudioUrl: config.lmStudioUrl ?? "http://192.168.64.1:1234",
        embeddingModel: config.embeddingModel ?? "text-embedding-qwen3-embedding-4b",
        embeddingDimension: config.embeddingDimension ?? 2560,
        batchSize: config.batchSize,
    });
    const backupManager = new BackupManager(resolvedDataDir, backupDir, config.maxBackups ?? 3, config.backupIntervalMs ?? 300_000);
    const index = new FaissIndex(config.embeddingDimension ?? 2560, resolvedDataDir);
    const manager = new MemoryManager(storage, index, embedder, backupManager, indexUpdateIntervalMs);
    const { version } = readVersion();
    const plugin = {
        name: "assistant-memory",
        version,
        async start() {
            try {
                manager.rebuildIndex();
            }
            catch (err) {
                console.warn(`[assistant-memory] Initial index rebuild failed: ${err}`);
            }
            try {
                backupManager.start();
            }
            catch (err) {
                console.warn(`[assistant-memory] Backup manager failed to start: ${err}`);
            }
            manager.startPeriodicUpdate();
            console.log(`[assistant-memory] started v${version} for agent ${agentId}`);
        },
        stop() {
            try {
                manager.stopPeriodicUpdate();
                backupManager.stop();
            }
            catch (err) {
                console.warn(`[assistant-memory] Error during shutdown: ${err}`);
            }
            console.log(`[assistant-memory] stopped`);
        },
        async search(query, limit = 5) {
            return manager.search(query, limit);
        },
        async add(id, content) {
            await manager.add(content, [], `id:${id}`);
        },
        async remove(id) {
            return manager.forget(id);
        },
        async getStats() {
            const s = manager.stats();
            return { count: s.totalMemories, lastIndexed: null };
        },
    };
    return plugin;
}
//# sourceMappingURL=plugin.js.map