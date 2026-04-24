/**
 * File-based memory storage layer.
 *
 * Each memory item is stored as a separate JSON file:
 *   {dataDir}/{id}.json
 *
 * Memory item schema:
 *   { id, text, embedding, timestamp, tags, source }
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface MemoryItem {
  id: string;
  text: string;
  embedding: number[];
  timestamp: number;
  tags: string[];
  source?: string;
}

export class MemoryStorage {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
  }

  /** Path to a single memory item file */
  private itemPath(id: string): string {
    return join(this.dataDir, `${id}.json`);
  }

  /**
   * Add a new memory item. Generates a UUID if id is not provided.
   * Returns the final MemoryItem (with generated id if needed).
   */
  add(text: string, embedding: number[], tags: string[] = [], source?: string, id?: string): MemoryItem {
    const item: MemoryItem = {
      id: id ?? randomUUID(),
      text,
      embedding,
      timestamp: Date.now(),
      tags,
      source,
    };
    writeFileSync(this.itemPath(item.id), JSON.stringify(item, null, 2), "utf-8");
    return item;
  }

  /**
   * Get a single memory item by id.
   * Returns undefined if not found.
   */
  get(id: string): MemoryItem | undefined {
    const path = this.itemPath(id);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as MemoryItem;
    } catch {
      return undefined;
    }
  }

  /**
   * Get all memory items, sorted newest-first by default.
   */
  getAll(sortNewestFirst = true): MemoryItem[] {
    if (!existsSync(this.dataDir)) return [];
    const files = readdirSync(this.dataDir).filter((f) => f.endsWith(".json"));
    const items: MemoryItem[] = [];
    for (const file of files) {
      try {
        const item = JSON.parse(readFileSync(join(this.dataDir, file), "utf-8")) as MemoryItem;
        items.push(item);
      } catch {
        // Skip corrupt files
      }
    }
    if (sortNewestFirst) {
      items.sort((a, b) => b.timestamp - a.timestamp);
    }
    return items;
  }

  /**
   * Delete a memory item by id.
   * Returns true if deleted, false if not found.
   */
  delete(id: string): boolean {
    const path = this.itemPath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  /**
   * Delete all memory items.
   */
  clear(): void {
    const items = this.getAll(false);
    for (const item of items) {
      this.delete(item.id);
    }
  }

  /**
   * Get total count of memory items.
   */
  count(): number {
    if (!existsSync(this.dataDir)) return 0;
    return readdirSync(this.dataDir).filter((f) => f.endsWith(".json")).length;
  }

  /**
   * Get all memory items that match any of the given tags.
   */
  getByTags(tags: string[], matchAny = true): MemoryItem[] {
    const all = this.getAll();
    return all.filter((item) => {
      if (matchAny) {
        return item.tags.some((t) => tags.includes(t));
      }
      return tags.every((t) => item.tags.includes(t));
    });
  }
}
