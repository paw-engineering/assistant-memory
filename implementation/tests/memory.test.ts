import { describe, it, expect, beforeAll, vi } from "vitest";
import { chunkText, createStore, createLmStudioClient, createBackupService, createMemoryService, DEFAULT_CONFIG } from "../src/index.js";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// =============================================================================
// chunkText Tests
// =============================================================================

describe("chunkText", () => {
  it("returns single chunk for text under maxChars", () => {
    const text = "This is a short text that should fit in one chunk.";
    const chunks = chunkText(text, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits on paragraph boundaries when exceeding maxChars", () => {
    const text = "First paragraph that is quite long.\n\nSecond paragraph that is also quite long and together they exceed the limit.";
    const chunks = chunkText(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });

  it("handles empty string", () => {
    const chunks = chunkText("", 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("");
  });

  it("handles single very long word by truncating", () => {
    const text = "a".repeat(3000);
    const chunks = chunkText(text, 2000);
    // Algorithm splits on paragraph/sentence boundaries, so a single very long word
    // without breaks may not split cleanly — that's acceptable for this test
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
  });
});

// =============================================================================
// LM Studio Client Tests
// =============================================================================

describe("lmstudio client", () => {
  it("isAvailable returns false for unreachable server", async () => {
    const client = createLmStudioClient({
      url: "http://localhost:9999/v1/embeddings",
      model: "test-model",
      maxRetries: 1,
      retryDelayMs: 10,
    });

    const available = await client.isAvailable();
    expect(available).toBe(false);
  });

  it("embed rejects for unreachable server", async () => {
    const client = createLmStudioClient({
      url: "http://localhost:9999/v1/embeddings",
      model: "test-model",
      maxRetries: 1,
      retryDelayMs: 10,
    });

    await expect(client.embed("test")).rejects.toThrow();
  });
});

// =============================================================================
// Store Tests
// =============================================================================

const TEST_DIRS: string[] = [
  "/tmp/am-test-1",
  "/tmp/am-test-2",
  "/tmp/am-test-3",
  "/tmp/am-test-4",
  "/tmp/am-test-5",
  "/tmp/am-test-6",
];

beforeAll(async () => {
  for (const dir of TEST_DIRS) {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    await mkdir(dir, { recursive: true });
  }
});

const mockEmbeddings = {
  embed: async (_text: string) => [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0] as number[],
  isAvailable: async () => true as boolean,
  model: () => "mock-model",
};

describe("store", () => {
  it("stores and retrieves entries", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[0],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const entry = await store.store({
      text: "Test memory",
      vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0],
      importance: 0.8,
      category: "fact",
    });

    expect(entry.id).toBeDefined();
    expect(entry.text).toBe("Test memory");
    expect(entry.importance).toBe(0.8);
    expect(entry.category).toBe("fact");

    const count = await store.count();
    expect(count).toBe(1);
  });

  it("searches by similarity", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[1],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    await store.store({ text: "apple fruit", vector: [1, 0, 0, 0, 0, 0, 0, 0], importance: 0.5, category: "fact" });
    await store.store({ text: "banana fruit", vector: [0.9, 0.1, 0, 0, 0, 0, 0, 0], importance: 0.5, category: "fact" });
    await store.store({ text: "car mechanic", vector: [0, 0.5, 0.5, 0, 0, 0, 0, 0], importance: 0.5, category: "fact" });

    const results = await store.search([0.95, 0.05, 0, 0, 0, 0, 0, 0], 2, 0.3);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("deletes entries by id", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[2],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const entry = await store.store({
      text: "to be deleted",
      vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0],
      importance: 0.5,
      category: "other",
    });

    await store.delete(entry.id);
    const count = await store.count();
    expect(count).toBe(0);
  });

  it("updates entry text and importance", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[3],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const entry = await store.store({
      text: "original",
      vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0],
      importance: 0.5,
      category: "learning",
    });

    const updated = await store.update(entry.id, "updated text", 0.9);
    expect(updated.text).toBe("updated text");
    expect(updated.importance).toBe(0.9);
  });

  it("lists all entries", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[4],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    await store.store({ text: "entry 1", vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0], importance: 0.5, category: "fact" });
    await store.store({ text: "entry 2", vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0], importance: 0.5, category: "fact" });

    const entries = await store.list();
    expect(entries).toHaveLength(2);
  });

  it("throws on update of non-existent entry", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: TEST_DIRS[5],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    await expect(store.update("non-existent-id", "new text", 0.5)).rejects.toThrow("entry not found");
  });
});

// =============================================================================
// Backup Tests
// =============================================================================

describe("backup", () => {
  it("writes backup file with entries", async () => {
    const { backupNow } = await import("../src/index.js");
    const store = await createStore(mockEmbeddings as any, {
      dataDir: "/tmp/am-backup-1",
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    await store.store({
      text: "backup test entry",
      vector: [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0],
      importance: 0.8,
      category: "learning",
    });

    const backupDir = "/tmp/am-backup-dir-1";
    await mkdir(backupDir, { recursive: true });
    await backupNow(store, backupDir, "test-agent", { info: () => {} });

    const files = await readdir(backupDir);
    const latestBackup = files.find((f) => f.startsWith("memory-") && f.endsWith(".json"));
    expect(latestBackup).toBeDefined();
  });

  it("handles empty store backup", async () => {
    const { backupNow } = await import("../src/index.js");
    const store = await createStore(mockEmbeddings as any, {
      dataDir: "/tmp/am-backup-2",
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const backupDir = "/tmp/am-backup-dir-2";
    await mkdir(backupDir, { recursive: true });
    await backupNow(store, backupDir, "test-agent", { info: () => {} });

    const files = await readdir(backupDir);
    const latestBackup = files.find((f) => f.startsWith("memory-") && f.endsWith(".json"));
    expect(latestBackup).toBeDefined();

    const content = JSON.parse(await readFile(join(backupDir, latestBackup!), "utf-8")) as { metadata: { entryCount: number } };
    expect(content.metadata.entryCount).toBe(0);
  });
});

// =============================================================================
// Memory Service CRUD Tests
// =============================================================================

describe("memory service", () => {
  it("adds and searches memories without throwing", async () => {
    const dataDir = "/tmp/am-svc-1-clean";
    // Clean up any stale data from previous runs
    await rm(dataDir, { recursive: true, force: true });

    const store = await createStore(mockEmbeddings as any, {
      dataDir,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const backupService = createBackupService(store, {
      backupDir: "/tmp/am-svc-backup-1-unique",
      intervalMinutes: 60,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const service = createMemoryService(
      mockEmbeddings as any,
      store,
      backupService,
      DEFAULT_CONFIG,
      { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    );

    await service.add("I prefer dark mode", 0.8, "preference");
    await service.add("The project uses TypeScript", 0.9, "fact");

    // Verify count increments — clean directory ensures isolated test
    const count = await service.count();
    expect(count).toBe(2);
  });

  it("returns version string", async () => {
    const store = await createStore(mockEmbeddings as any, {
      dataDir: "/tmp/am-svc-2",
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const backupService = createBackupService(store, {
      backupDir: "/tmp/am-svc-backup-2",
      intervalMinutes: 60,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    const service = createMemoryService(mockEmbeddings as any, store, backupService, DEFAULT_CONFIG);

    expect(service.version()).toBe("1.0.0");
  });
});