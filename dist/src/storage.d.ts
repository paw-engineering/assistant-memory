/**
 * File-based memory storage layer.
 *
 * Each memory item is stored as a separate JSON file:
 *   {dataDir}/{id}.json
 *
 * Memory item schema:
 *   { id, text, embedding, timestamp, tags, source }
 */
export interface MemoryItem {
    id: string;
    text: string;
    embedding: number[];
    timestamp: number;
    tags: string[];
    source?: string;
}
export declare class MemoryStorage {
    private dataDir;
    constructor(dataDir: string);
    /** Path to a single memory item file */
    private itemPath;
    /**
     * Add a new memory item. Generates a UUID if id is not provided.
     * Returns the final MemoryItem (with generated id if needed).
     */
    add(text: string, embedding: number[], tags?: string[], source?: string, id?: string): MemoryItem;
    /**
     * Get a single memory item by id.
     * Returns undefined if not found.
     */
    get(id: string): MemoryItem | undefined;
    /**
     * Get all memory items, sorted newest-first by default.
     */
    getAll(sortNewestFirst?: boolean): MemoryItem[];
    /**
     * Delete a memory item by id.
     * Returns true if deleted, false if not found.
     */
    delete(id: string): boolean;
    /**
     * Delete all memory items.
     */
    clear(): void;
    /**
     * Get total count of memory items.
     */
    count(): number;
    /**
     * Get all memory items that match any of the given tags.
     */
    getByTags(tags: string[], matchAny?: boolean): MemoryItem[];
}
//# sourceMappingURL=storage.d.ts.map