/**
 * FAISS index wrapper for vector similarity search.
 *
 * Supports:
 * - Adding vectors with associated string IDs
 * - Similarity search by vector or raw text (auto-embeds)
 * - Saving/loading the index to disk
 * - ID tracking via a companion JSON file
 *
 * Uses faiss-node's IndexFlatL2 (exhaustive L2 search).
 */
export interface FaissSearchResult {
    id: string;
    score: number;
}
/**
 * A FAISS IndexFlatL2 wrapper that tracks string IDs alongside vector data.
 * Saves index to {dataDir}/index.faiss and ID map to {dataDir}/index-ids.json.
 */
export declare class FaissIndex {
    private dimension;
    private index;
    private ids;
    private dataDir;
    private idMapPath;
    constructor(dimension: number, dataDir: string);
    /**
     * Get the next sequential integer ID for a new vector.
     */
    private nextId;
    /**
     * Add a single text vector with its associated string ID.
     * faiss-node's add() takes a flat number[] of size n*d; we add one at a time.
     */
    add(id: string, embedding: number[]): void;
    /**
     * Add multiple vectors at once.
     */
    addBatch(items: Array<{
        id: string;
        embedding: number[];
    }>): void;
    /**
     * Search for the k nearest neighbors to the given embedding.
     */
    search(embedding: number[], k: number): FaissSearchResult[];
    /**
     * Get total number of vectors in the index.
     */
    size(): number;
    /**
     * Clear all vectors and IDs by replacing with a fresh index.
     */
    reset(): void;
    /**
     * Save the index and ID map to disk.
     */
    save(): void;
    /**
     * Load the index and ID map from disk.
     * If files do not exist, this is a no-op (empty index).
     */
    load(): void;
    /**
     * Rebuild the index from a fresh list of (id, embedding) pairs.
     * This replaces the current index entirely.
     */
    rebuild(items: Array<{
        id: string;
        embedding: number[];
    }>): void;
    /**
     * Get all tracked IDs.
     */
    getIds(): string[];
}
//# sourceMappingURL=faiss.d.ts.map