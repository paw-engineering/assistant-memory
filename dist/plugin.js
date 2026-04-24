/**
 * Per-Agent Memory Plugin — Plugin Entry Point
 *
 * Exposes the plugin to the DWG Assistant host via createPlugin().
 * The host calls initPlugin() to start the plugin and obtain the plugin API.
 */
import { loadConfig, validateConfig, resolveDataDir } from "./config.js";
import { enforceVersion } from "./versioning.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let managerInstance = null;
async function createManager(config, dataDir, backupDir) {
    // Dynamic imports to avoid circular deps
    const { MemoryManager } = await import("./memory.js");
    const { MemoryStorage } = await import("./storage.js");
    const { FaissIndex } = await import("./faiss.js");
    const { Embedder } = await import("./embedder.js");
    const { BackupManager } = await import("./backup.js");
    const storage = new MemoryStorage(dataDir);
    const index = new FaissIndex(config.embeddingDimension, dataDir);
    index.load();
    const embedder = new Embedder({
        lmStudioUrl: config.lmStudioUrl,
        embeddingModel: config.embeddingModel,
        embeddingDimension: config.embeddingDimension,
        batchSize: config.batchSize,
    });
    const backup = new BackupManager(dataDir, backupDir, config.maxBackups, config.backupIntervalMs);
    backup.start();
    const manager = new MemoryManager(storage, index, embedder, backup, config.indexUpdateIntervalMs ?? 30_000);
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
export async function initPlugin(agentId, baseDir, events) {
    enforceVersion();
    const config = loadConfig(agentId, baseDir);
    validateConfig(config);
    const dataDir = resolveDataDir(config);
    const backupDir = `${dataDir}-backups`;
    const manager = await createManager(config, dataDir, backupDir);
    managerInstance = manager;
    return {
        agentId: config.agentId,
        async add(text, tags = [], source) {
            const item = await manager.add(text, tags, source);
            events?.onMemoryAdded?.({ id: item.id, text: item.text, tags: item.tags });
            return { id: item.id };
        },
        async search(query, k = 5) {
            return manager.search(query, k);
        },
        remember(id) {
            return manager.remember(id);
        },
        async forget(id) {
            const result = manager.forget(id);
            if (result)
                events?.onMemoryForgotten?.(id);
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
        getByTags(tags, matchAny = true) {
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
export async function createPlugin(agentId, baseDir, events) {
    return initPlugin(agentId, baseDir, events);
}
//# sourceMappingURL=plugin.js.map