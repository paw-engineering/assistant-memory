/**
 * In-memory vector store for agent memories.
 *
 * Provides a simple in-memory store with vector similarity search,
 * file-based chunk organization, and metadata storage.
 * Used by the search server for testing and standalone operation.
 */
export interface Chunk {
    id: string;
    filePath: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
    createdAt: number;
    modifiedAt: number;
}
/**
 * In-memory chunk store with vector search and file management.
 */
export declare class MemoryStore {
    private chunks;
    private files;
    private meta;
    private dataPath;
    constructor(dataDir: string);
    private load;
    private save;
    /**
     * Store or update a chunk.
     */
    upsertChunk(chunk: Chunk): void;
    /**
     * Get all chunks for a specific file.
     */
    getChunksByFile(filePath: string): Chunk[];
    /**
     * Delete all chunks for a specific file.
     */
    deleteChunksForFile(filePath: string): void;
    /**
     * Search chunks by vector similarity (cosine similarity).
     */
    searchByVector(queryEmbedding: number[], topK: number): Chunk[];
    /**
     * Get total number of chunks.
     */
    getChunkCount(): number;
    /**
     * Get total number of unique files.
     */
    getFileCount(): number;
    /**
     * Set a metadata key-value pair.
     */
    setMeta(key: string, value: string): void;
    /**
     * Get a metadata value by key.
     */
    getMeta(key: string): string | null;
    /**
     * Clear all stored data.
     */
    clear(): void;
    /**
     * Get all chunks (for debugging/testing).
     */
    getAllChunks(): Chunk[];
}
//# sourceMappingURL=store.d.ts.map