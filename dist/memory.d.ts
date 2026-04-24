/**
 * Memory manager — wires together embedder, FAISS index, and storage.
 *
 * Provides:
 * - add(text, tags, source?) — embed + store + update index
 * - search(query, k?) — embed query + search index
 * - remember(id) — retrieve raw memory item
 * - forget(id) — remove memory item and rebuild index
 * - getRecent(limit?) — get most recent memories
 * - rebuildIndex() — force a full index rebuild from storage
 *
 * Index update strategy:
 * - on-change: immediately after add/forget
 * - periodic fallback: timer-driven rebuild every indexUpdateIntervalMs
 */
import { MemoryStorage, MemoryItem } from "./storage.js";
import { FaissIndex } from "./faiss.js";
import { Embedder } from "./embedder.js";
import { BackupManager } from "./backup.js";
export interface MemorySearchResult {
    id: string;
    text: string;
    score: number;
    timestamp: number;
    tags: string[];
    source?: string;
}
export interface MemoryStats {
    totalMemories: number;
    indexSize: number;
    storageCount: number;
}
export declare class MemoryManager {
    private storage;
    private index;
    private embedder;
    private backup;
    private periodicTimer;
    private indexUpdateIntervalMs;
    constructor(storage: MemoryStorage, index: FaissIndex, embedder: Embedder, backup: BackupManager, indexUpdateIntervalMs: number);
    /**
     * Add a new memory: embed text, persist to storage, update index.
     */
    add(text: string, tags?: string[], source?: string): Promise<MemoryItem>;
    /**
     * Search memories by semantic similarity.
     */
    search(query: string, k?: number): Promise<MemorySearchResult[]>;
    /**
     * Retrieve a specific memory by id.
     */
    remember(id: string): MemoryItem | undefined;
    /**
     * Remove a memory by id: delete from storage, rebuild index.
     */
    forget(id: string): boolean;
    /**
     * Get the N most recent memories, newest-first.
     */
    getRecent(limit?: number): MemoryItem[];
    /**
     * Get all memories that match any of the given tags.
     */
    getByTags(tags: string[], matchAny?: boolean): MemoryItem[];
    /**
     * Force a full index rebuild from all items currently in storage.
     */
    rebuildIndex(): void;
    /**
     * Get memory statistics.
     */
    stats(): MemoryStats;
    /**
     * Start the periodic index rebuild timer (fallback strategy).
     */
    startPeriodicUpdate(): void;
    /**
     * Stop the periodic index rebuild timer.
     */
    stopPeriodicUpdate(): void;
    /**
     * Trigger an immediate backup snapshot.
     */
    backupNow(): void;
    /**
     * Shutdown: stop timers and save state.
     */
    shutdown(): void;
}
//# sourceMappingURL=memory.d.ts.map