/**
 * In-memory vector store for agent memories.
 * 
 * Provides a simple in-memory store with vector similarity search,
 * file-based chunk organization, and metadata storage.
 * Used by the search server for testing and standalone operation.
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

export interface Chunk {
  id: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  createdAt: number;
  modifiedAt: number;
  charStart?: number;
  charEnd?: number;
}

interface SerializedStore {
  chunks: Chunk[];
  meta: Record<string, string>;
  files: Record<string, string[]>; // filePath -> chunkIds
}

/**
 * In-memory chunk store with vector search and file management.
 */
export class MemoryStore {
  private chunks: Map<string, Chunk> = new Map();
  private files: Map<string, Set<string>> = new Map(); // filePath -> Set of chunk IDs
  private meta: Map<string, string> = new Map();
  private dataPath: string;

  constructor(dataDir: string) {
    this.dataPath = join(dataDir, "memory-store.json");
    mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private load(): void {
    if (existsSync(this.dataPath)) {
      try {
        const data = JSON.parse(readFileSync(this.dataPath, "utf-8")) as SerializedStore;
        this.chunks = new Map(data.chunks.map(c => [c.id, c]));
        this.meta = new Map(Object.entries(data.meta || {}));
        this.files = new Map();
        for (const [path, ids] of Object.entries(data.files || {})) {
          this.files.set(path, new Set(ids));
        }
      } catch {
        // Start fresh on corruption
        this.chunks = new Map();
        this.files = new Map();
        this.meta = new Map();
      }
    }
  }

  private save(): void {
    const data: SerializedStore = {
      chunks: Array.from(this.chunks.values()),
      meta: Object.fromEntries(this.meta),
      files: Object.fromEntries(
        Array.from(this.files.entries()).map(([path, ids]) => [path, Array.from(ids)])
      ),
    };
    writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
  }

  /**
   * Store or update a chunk.
   */
  upsertChunk(chunk: Chunk): void {
    // Remove from old file tracking if exists
    const existing = this.chunks.get(chunk.id);
    if (existing) {
      const oldFileChunks = this.files.get(existing.filePath);
      if (oldFileChunks) {
        oldFileChunks.delete(chunk.id);
      }
    }

    this.chunks.set(chunk.id, chunk);

    if (!this.files.has(chunk.filePath)) {
      this.files.set(chunk.filePath, new Set());
    }
    this.files.get(chunk.filePath)!.add(chunk.id);

    this.save();
  }

  /**
   * Get all chunks for a specific file.
   */
  getChunksByFile(filePath: string): Chunk[] {
    const chunkIds = this.files.get(filePath);
    if (!chunkIds) return [];
    return Array.from(chunkIds)
      .map(id => this.chunks.get(id))
      .filter((c): c is Chunk => c !== undefined)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  /**
   * Delete all chunks for a specific file.
   */
  deleteChunksForFile(filePath: string): void {
    const chunkIds = this.files.get(filePath);
    if (chunkIds) {
      for (const id of chunkIds) {
        this.chunks.delete(id);
      }
    }
    this.files.delete(filePath);
    this.save();
  }

  /**
   * Search chunks by vector similarity (cosine similarity).
   */
  searchByVector(queryEmbedding: number[], topK: number): Chunk[] {
    const chunks = Array.from(this.chunks.values());
    
    // Score all chunks by cosine similarity
    const scored = chunks.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(s => s.chunk);
  }

  /**
   * Get total number of chunks.
   */
  getChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Get total number of unique files.
   */
  getFileCount(): number {
    return this.files.size;
  }

  /**
   * Set a metadata key-value pair.
   */
  setMeta(key: string, value: string): void {
    this.meta.set(key, value);
    this.save();
  }

  /**
   * Get a metadata value by key.
   */
  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.chunks.clear();
    this.files.clear();
    this.meta.clear();
    this.save();
  }

  /**
   * Get all chunks (for debugging/testing).
   */
  getAllChunks(): Chunk[] {
    return Array.from(this.chunks.values());
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}