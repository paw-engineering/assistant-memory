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
import { FaissIndex, FaissSearchResult } from "./faiss.js";
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

export class MemoryManager {
  private storage: MemoryStorage;
  private index: FaissIndex;
  private embedder: Embedder;
  private backup: BackupManager;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private indexUpdateIntervalMs: number;

  constructor(
    storage: MemoryStorage,
    index: FaissIndex,
    embedder: Embedder,
    backup: BackupManager,
    indexUpdateIntervalMs: number
  ) {
    this.storage = storage;
    this.index = index;
    this.embedder = embedder;
    this.backup = backup;
    this.indexUpdateIntervalMs = indexUpdateIntervalMs;
  }

  /**
   * Add a new memory: embed text, persist to storage, update index.
   */
  async add(text: string, tags: string[] = [], source?: string): Promise<MemoryItem> {
    const embedding = await this.embedder.embedText(text);
    const item = this.storage.add(text, embedding, tags, source);
    this.index.add(item.id, embedding);
    this.index.save();
    return item;
  }

  /**
   * Search memories by semantic similarity.
   */
  async search(query: string, k = 5): Promise<MemorySearchResult[]> {
    const queryEmbedding = await this.embedder.embedText(query);
    const faissResults = this.index.search(queryEmbedding, k);

    return faissResults
      .map((result: FaissSearchResult) => {
        const item = this.storage.get(result.id);
        if (!item) return null;
        return {
          id: item.id,
          text: item.text,
          score: result.score,
          timestamp: item.timestamp,
          tags: item.tags,
          source: item.source,
        } as MemorySearchResult;
      })
      .filter((r): r is MemorySearchResult => r !== null);
  }

  /**
   * Retrieve a specific memory by id.
   */
  remember(id: string): MemoryItem | undefined {
    return this.storage.get(id);
  }

  /**
   * Remove a memory by id: delete from storage, rebuild index.
   */
  forget(id: string): boolean {
    const deleted = this.storage.delete(id);
    if (!deleted) return false;
    this.rebuildIndex();
    return true;
  }

  /**
   * Get the N most recent memories, newest-first.
   */
  getRecent(limit = 10): MemoryItem[] {
    return this.storage.getAll(true).slice(0, limit);
  }

  /**
   * Get all memories that match any of the given tags.
   */
  getByTags(tags: string[], matchAny = true): MemoryItem[] {
    return this.storage.getByTags(tags, matchAny);
  }

  /**
   * Force a full index rebuild from all items currently in storage.
   */
  rebuildIndex(): void {
    const items = this.storage.getAll(false);
    this.index.rebuild(items.map((item) => ({ id: item.id, embedding: item.embedding })));
    this.index.save();
  }

  /**
   * Get memory statistics.
   */
  stats(): MemoryStats {
    return {
      totalMemories: this.storage.count(),
      indexSize: this.index.size(),
      storageCount: this.storage.count(),
    };
  }

  /**
   * Start the periodic index rebuild timer (fallback strategy).
   */
  startPeriodicUpdate(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      try {
        this.rebuildIndex();
        console.log(`[memory] Periodic index rebuild completed at ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`[memory] Periodic index rebuild failed: ${err}`);
      }
    }, this.indexUpdateIntervalMs);
  }

  /**
   * Stop the periodic index rebuild timer.
   */
  stopPeriodicUpdate(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Trigger an immediate backup snapshot.
   */
  backupNow(): void {
    this.backup.snapshot();
  }

  /**
   * Shutdown: stop timers and save state.
   */
  shutdown(): void {
    this.stopPeriodicUpdate();
    this.backup.stop();
    this.index.save();
  }
}
