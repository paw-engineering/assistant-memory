/**
 * Comprehensive test suite for assistant-memory plugin.
 * Uses vitest with a fake embedder so tests run without LM Studio.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../src/storage.js";
import { FaissIndex } from "../src/faiss.js";
import { MemoryManager } from "../src/memory.js";
import type { Embedder } from "../src/embedder.js";
import { BackupManager } from "../src/backup.js";

// ---------------------------------------------------------------------------
// Fake embedder
// ---------------------------------------------------------------------------

const EMBEDDING_DIM = 2560;

/**
 * Fake embedder that returns deterministic float32 vectors based on text content.
 *
 * Uses a keyword-activated scheme to produce semantically meaningful similarity:
 * - 30 dimensions are reserved as "keyword dimensions" at the start of the vector
 * - Each keyword dimension is activated by a hash of the keyword
 * - If the text contains the keyword, the dimension value is set based on keyword hash
 * - Remaining dimensions encode the full text hash for general-purpose similarity
 *
 * This means:
 * - Texts sharing a keyword will have that dimension in common → similar vectors
 * - Searching for a keyword activates its dimension → finds texts with that keyword
 * - Ranking is based on L2 distance in the full 2560-dim space
 */
const KEYWORDS = [
  "france", "paris", "capital",
  "hiking", "mountain", "outdoor",
  "chocolate", "cake", "baking", "dessert",
  "guitar", "music",
  "cooking", "pasta", "olive", "italian",
  "apple", "banana", "fruit",
  "remember", "memory",
  "test",
  "alpha", "beta", "gamma",
  "book", "read",
];

class FakeEmbedder {
  constructor(private dimension = EMBEDDING_DIM) {}

  async embedText(text: string): Promise<number[]> {
    const vector = new Float32Array(this.dimension);
    const textLower = text.toLowerCase();

    // Keyword dimensions
    for (let ki = 0; ki < KEYWORDS.length && ki < this.dimension; ki++) {
      const kw = KEYWORDS[ki];
      if (textLower.includes(kw)) {
        let seed = this.hashString(kw);
        seed = (seed * 1664525 + 1013904223) >>> 0;
        vector[ki] = (seed % 1000) / 1000 - 0.5;
      }
    }

    // Remaining dimensions: encode full text hash
    const totalKWDimensions = Math.min(KEYWORDS.length, this.dimension);
    const remaining = this.dimension - totalKWDimensions;
    let seed = this.hashString(text);
    for (let i = 0; i < remaining; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      vector[totalKWDimensions + i] = (seed % 10000) / 10000 - 0.5;
    }

    // L2-normalize
    let normSq = 0;
    for (let i = 0; i < this.dimension; i++) normSq += vector[i] * vector[i];
    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) vector[i] /= norm;
    }

    return Array.from(vector);
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  getDimension(): number {
    return this.dimension;
  }
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join("/tmp", `memory-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MemoryStorage", () => {
  let storageDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    storageDir = makeTempDir();
    storage = new MemoryStorage(storageDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanTempDir(storageDir);
  });

  it("add() returns a MemoryItem with an id", () => {
    vi.setSystemTime(new Date(1000));
    const item = storage.add("hello world", [0.1, 0.2], ["greeting"]);
    expect(item.id).toBeTruthy();
    expect(item.text).toBe("hello world");
    expect(item.embedding).toEqual([0.1, 0.2]);
    expect(item.tags).toEqual(["greeting"]);
    expect(item.timestamp).toBe(1000);
  });

  it("add() accepts a custom id", () => {
    vi.setSystemTime(new Date(1001));
    const item = storage.add("hello world", [0.1, 0.2], [], undefined, "my-id");
    expect(item.id).toBe("my-id");
  });

  it("get() returns the stored item", () => {
    vi.setSystemTime(new Date(1002));
    const item = storage.add("hello world", [0.1, 0.2], ["greeting"]);
    const retrieved = storage.get(item.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.text).toBe("hello world");
    expect(retrieved!.id).toBe(item.id);
  });

  it("get() returns undefined for unknown id", () => {
    expect(storage.get("nonexistent")).toBeUndefined();
  });

  it("delete() removes the item and returns true", () => {
    vi.setSystemTime(new Date(1003));
    const item = storage.add("hello world", [0.1, 0.2], []);
    const result = storage.delete(item.id);
    expect(result).toBe(true);
    expect(storage.get(item.id)).toBeUndefined();
  });

  it("delete() returns false for unknown id", () => {
    expect(storage.delete("nonexistent")).toBe(false);
  });

  it("getAll() returns all items sorted newest-first by default", () => {
    vi.setSystemTime(new Date(2000));
    const first = storage.add("first", [0.1], []);
    vi.setSystemTime(new Date(2001));
    const second = storage.add("second", [0.2], []);
    const all = storage.getAll();
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id); // newest first
    expect(all[1].id).toBe(first.id);
  });

  it("getAll(sortNewestFirst=false) returns items oldest-first", () => {
    vi.setSystemTime(new Date(3000));
    const first = storage.add("first", [0.1], []);
    vi.setSystemTime(new Date(3001));
    const second = storage.add("second", [0.2], []);
    const all = storage.getAll(false);
    expect(all[0].id).toBe(first.id);
    expect(all[1].id).toBe(second.id);
  });

  it("count() returns the number of items", () => {
    expect(storage.count()).toBe(0);
    vi.setSystemTime(new Date(4000));
    storage.add("a", [0.1], []);
    vi.setSystemTime(new Date(4001));
    storage.add("b", [0.2], []);
    expect(storage.count()).toBe(2);
  });

  it("clear() removes all items", () => {
    vi.setSystemTime(new Date(5000));
    storage.add("a", [0.1], []);
    vi.setSystemTime(new Date(5001));
    storage.add("b", [0.2], []);
    storage.clear();
    expect(storage.count()).toBe(0);
  });

  it("getByTags() finds items with matching tags (matchAny=true)", () => {
    vi.setSystemTime(new Date(6000));
    storage.add("apple", [0.1], ["fruit", "red"]);
    vi.setSystemTime(new Date(6001));
    storage.add("banana", [0.2], ["fruit", "yellow"]);
    vi.setSystemTime(new Date(6002));
    storage.add("carrot", [0.3], ["vegetable", "orange"]);

    const fruit = storage.getByTags(["fruit"], true);
    expect(fruit.length).toBe(2);
    expect(fruit.map(i => i.text)).toContain("apple");
    expect(fruit.map(i => i.text)).toContain("banana");

    const orange = storage.getByTags(["orange"], true);
    expect(orange.length).toBe(1);
    expect(orange[0].text).toBe("carrot");
  });

  it("getByTags() finds items with all tags (matchAny=false)", () => {
    vi.setSystemTime(new Date(7000));
    storage.add("apple", [0.1], ["fruit", "red"]);
    vi.setSystemTime(new Date(7001));
    storage.add("banana", [0.2], ["fruit", "yellow"]);

    const both = storage.getByTags(["fruit"], false);
    expect(both.length).toBe(2);

    const redFruit = storage.getByTags(["fruit", "red"], false);
    expect(redFruit.length).toBe(1);
    expect(redFruit[0].text).toBe("apple");

    // matchAny=false: item must have ALL query tags
    const redOnly = storage.getByTags(["red"], false);
    expect(redOnly.length).toBe(1);
    expect(redOnly[0].text).toBe("apple");

    const vegOnly = storage.getByTags(["vegetable"], false);
    expect(vegOnly.length).toBe(0);
  });

  it("getByTags() with no matches returns empty array", () => {
    vi.setSystemTime(new Date(8000));
    storage.add("apple", [0.1], ["fruit"]);
    const result = storage.getByTags(["nonexistent"], true);
    expect(result).toHaveLength(0);
  });
});

describe("MemoryManager — add + search round-trip", () => {
  let storageDir: string;
  let storage: MemoryStorage;
  let index: FaissIndex;
  let manager: MemoryManager;

  beforeEach(() => {
    storageDir = makeTempDir();
    storage = new MemoryStorage(storageDir);
    const indexDir = makeTempDir();
    index = new FaissIndex(EMBEDDING_DIM, indexDir);
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("adds a memory and search finds it", async () => {
    const item = await manager.add("I love playing guitar in the evenings");
    expect(item.id).toBeTruthy();

    const results = await manager.search("guitar music", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toBe("I love playing guitar in the evenings");
  });

  it("search returns results with id, text, score, timestamp, tags", async () => {
    await manager.add("cooking pasta with olive oil", ["food", "italian"]);

    const results = await manager.search("Italian cuisine", 5);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.id).toBeTruthy();
    expect(r.text).toBe("cooking pasta with olive oil");
    expect(typeof r.score).toBe("number");
    expect(r.timestamp).toBeDefined();
    expect(r.tags).toEqual(["food", "italian"]);
  });

  it("search respects k limit", async () => {
    await manager.add("alpha", ["tag-a"]);
    await manager.add("beta", ["tag-a"]);
    await manager.add("gamma", ["tag-a"]);

    const results = await manager.search("alpha beta gamma", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("MemoryManager — forget()", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);

    await manager.add("remember this");
    await manager.add("forget about this");
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("forget() removes from storage", async () => {
    const all = manager.getRecent();
    const target = all.find(i => i.text === "forget about this")!;

    const result = manager.forget(target.id);
    expect(result).toBe(true);

    const remaining = manager.getRecent();
    expect(remaining.map(i => i.text)).not.toContain("forget about this");
  });

  it("forget() returns false for unknown id", () => {
    const result = manager.forget("nonexistent-id");
    expect(result).toBe(false);
  });

  it("forget() makes the memory unfindable by search", async () => {
    const all = manager.getRecent();
    const target = all.find(i => i.text === "forget about this")!;

    manager.forget(target.id);

    const results = await manager.search("this");
    expect(results.map(r => r.text)).not.toContain("forget about this");
  });

  it("forget() does not affect other memories", async () => {
    const all = manager.getRecent();
    const target = all.find(i => i.text === "forget about this")!;

    manager.forget(target.id);

    const results = await manager.search("remember");
    expect(results.map(r => r.text)).toContain("remember this");
  });
});

describe("MemoryManager — search ranking", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);

    // Add memories with distinct, keyword-rich content for good ranking separation
    await manager.add("The capital of France is Paris", ["geography", "europe"]);
    await manager.add("I enjoy hiking in mountain trails", ["outdoor", "fitness"]);
    await manager.add("Chocolate cake recipe with cocoa powder", ["baking", "dessert"]);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("searching for 'France' returns Paris memory first", async () => {
    const results = await manager.search("France travel", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("France");
    expect(results[0].text).toContain("Paris");
  });

  it("searching for 'hiking' returns outdoor memory first", async () => {
    const results = await manager.search("hiking mountains", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("hiking");
  });

  it("searching for 'dessert' returns chocolate cake first", async () => {
    const results = await manager.search("chocolate dessert", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("Chocolate");
  });

  it("relevant results are ranked above irrelevant ones", async () => {
    const results = await manager.search("baking", 3);
    const texts = results.map(r => r.text);
    // The baking/dessert memory should come first for a "baking" query
    expect(texts[0]).toContain("Chocolate cake");
  });
});

describe("MemoryManager — getByTags()", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);

    await manager.add("apple pie recipe", ["baking", "fruit"]);
    await manager.add("banana bread", ["baking"]);
    await manager.add("grilled chicken salad", ["cooking", "healthy"]);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("returns items with matching tag", () => {
    const results = manager.getByTags(["baking"]);
    expect(results.map(r => r.text)).toContain("apple pie recipe");
    expect(results.map(r => r.text)).toContain("banana bread");
  });

  it("returns items matching any of the given tags (matchAny)", () => {
    const results = manager.getByTags(["baking", "fruit"], true);
    expect(results.map(r => r.text)).toContain("apple pie recipe");
    expect(results.some(r => r.text === "banana bread")).toBe(true);
  });

  it("returns empty for no matches", () => {
    const results = manager.getByTags(["nonexistent"]);
    expect(results).toHaveLength(0);
  });
});

describe("MemoryManager — periodic update timer", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 10);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("startPeriodicUpdate() does not throw", () => {
    expect(() => manager.startPeriodicUpdate()).not.toThrow();
  });

  it("stopPeriodicUpdate() does not throw", () => {
    manager.startPeriodicUpdate();
    expect(() => manager.stopPeriodicUpdate()).not.toThrow();
  });

  it("start + stop + start again does not throw", () => {
    manager.startPeriodicUpdate();
    manager.stopPeriodicUpdate();
    expect(() => manager.startPeriodicUpdate()).not.toThrow();
    manager.stopPeriodicUpdate();
  });

  it("manager still works after start/stop cycles", async () => {
    manager.startPeriodicUpdate();
    manager.stopPeriodicUpdate();

    const item = await manager.add("test memory");
    const results = await manager.search("test", 5);
    expect(results.map(r => r.text)).toContain("test memory");
  });
});

describe("MemoryManager — stats()", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("stats() returns correct count after adding memories", async () => {
    await manager.add("memory one", ["tag1"]);
    await manager.add("memory two", ["tag2"]);
    await manager.add("memory three", ["tag3"]);

    const stats = manager.stats();
    expect(stats.totalMemories).toBe(3);
    expect(stats.storageCount).toBe(3);
    expect(stats.indexSize).toBe(3);
  });

  it("stats() returns correct count after forgetting a memory", async () => {
    const item = await manager.add("memory one", ["tag1"]);
    await manager.add("memory two", ["tag2"]);

    manager.forget(item.id);

    const stats = manager.stats();
    expect(stats.totalMemories).toBe(1);
    expect(stats.indexSize).toBe(1);
  });

  it("stats() returns zero for fresh manager", () => {
    const stats = manager.stats();
    expect(stats.totalMemories).toBe(0);
    expect(stats.storageCount).toBe(0);
    expect(stats.indexSize).toBe(0);
  });

  it("stats().indexSize matches storage count after rebuild", async () => {
    await manager.add("alpha");
    await manager.add("beta");
    await manager.add("gamma");

    manager.rebuildIndex();

    const stats = manager.stats();
    expect(stats.indexSize).toBe(stats.storageCount);
  });
});

describe("MemoryManager — remember()", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("remember() returns the item by id", async () => {
    const added = await manager.add("remember this moment", ["personal"]);
    const item = manager.remember(added.id);
    expect(item).not.toBeNull();
    expect(item!.text).toBe("remember this moment");
    expect(item!.tags).toEqual(["personal"]);
  });

  it("remember() returns undefined for unknown id", () => {
    expect(manager.remember("nonexistent")).toBeUndefined();
  });
});

describe("MemoryManager — getRecent()", () => {
  let storageDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    storageDir = makeTempDir();
    const storage = new MemoryStorage(storageDir);
    const index = new FaissIndex(EMBEDDING_DIM, makeTempDir());
    const fakeEmbedder = new FakeEmbedder();
    const backup = new BackupManager(storageDir, join(storageDir, "backups"), 3, 600_000);
    manager = new MemoryManager(storage, index, fakeEmbedder as unknown as Embedder, backup, 30_000);
  });

  afterEach(() => {
    manager.stopPeriodicUpdate();
    cleanTempDir(storageDir);
  });

  it("returns memories newest-first", async () => {
    await manager.add("first");
    await manager.add("second");
    await manager.add("third");

    const recent = manager.getRecent();
    expect(recent[0].text).toBe("third");
    expect(recent[1].text).toBe("second");
    expect(recent[2].text).toBe("first");
  });

  it("respects the limit argument", async () => {
    await manager.add("first");
    await manager.add("second");
    await manager.add("third");

    const recent = manager.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].text).toBe("third");
    expect(recent[1].text).toBe("second");
  });

  it("returns empty array when no memories exist", () => {
    expect(manager.getRecent()).toHaveLength(0);
  });
});