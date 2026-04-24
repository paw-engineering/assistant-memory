import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { MemoryStore } from "../src/store.js";
import { chunkText, chunkId, generateFileHash, fileId } from "../src/chunker.js";
import { tempfile } from "./helpers.js";
describe("MemoryStore", () => {
    let store;
    let tempDir;
    beforeEach(() => {
        tempDir = tempfile();
        store = new MemoryStore(tempDir);
    });
    it("should store and retrieve chunks", () => {
        const chunk = {
            id: "test_chunk_1",
            filePath: "/test/file.md",
            chunkIndex: 0,
            content: "Hello world",
            embedding: [0.1, 0.2, 0.3, 0.4],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            charStart: 0,
            charEnd: 11,
        };
        store.upsertChunk(chunk);
        const chunks = store.getChunksByFile("/test/file.md");
        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].content, "Hello world");
    });
    it("should delete chunks for a file", () => {
        const chunk = {
            id: "test_chunk_1",
            filePath: "/test/file.md",
            chunkIndex: 0,
            content: "Hello world",
            embedding: [0.1, 0.2, 0.3, 0.4],
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            charStart: 0,
            charEnd: 11,
        };
        store.upsertChunk(chunk);
        store.deleteChunksForFile("/test/file.md");
        const chunks = store.getChunksByFile("/test/file.md");
        assert.strictEqual(chunks.length, 0);
    });
    it("should search by vector similarity", () => {
        const now = Date.now();
        store.upsertChunk({
            id: "chunk_1",
            filePath: "/test/a.md",
            chunkIndex: 0,
            content: "Apple fruit",
            embedding: [1, 0, 0],
            createdAt: now,
            modifiedAt: now,
        });
        store.upsertChunk({
            id: "chunk_2",
            filePath: "/test/b.md",
            chunkIndex: 0,
            content: "Banana fruit",
            embedding: [0.9, 0.1, 0],
            createdAt: now,
            modifiedAt: now,
        });
        store.upsertChunk({
            id: "chunk_3",
            filePath: "/test/c.md",
            chunkIndex: 0,
            content: "Carrot vegetable",
            embedding: [0, 1, 0],
            createdAt: now,
            modifiedAt: now,
        });
        // Search for fruit-like content
        const results = store.searchByVector([0.95, 0.05, 0], 2);
        assert.strictEqual(results.length, 2);
        // Should return Banana first (more similar), then Apple
        assert.ok(results[0].content.includes("Banana") || results[0].content.includes("Apple"));
    });
    it("should track meta information", () => {
        store.setMeta("version", "1.0.0");
        store.setMeta("last_index", "2024-01-01");
        assert.strictEqual(store.getMeta("version"), "1.0.0");
        assert.strictEqual(store.getMeta("last_index"), "2024-01-01");
        assert.strictEqual(store.getMeta("nonexistent"), null);
    });
    it("should count chunks and files correctly", () => {
        const now = Date.now();
        store.upsertChunk({
            id: "c1",
            filePath: "/test/a.md",
            chunkIndex: 0,
            content: "Content 1",
            embedding: [0.1, 0.2],
            createdAt: now,
            modifiedAt: now,
        });
        store.upsertChunk({
            id: "c2",
            filePath: "/test/a.md",
            chunkIndex: 1,
            content: "Content 2",
            embedding: [0.3, 0.4],
            createdAt: now,
            modifiedAt: now,
        });
        store.upsertChunk({
            id: "c3",
            filePath: "/test/b.md",
            chunkIndex: 0,
            content: "Content 3",
            embedding: [0.5, 0.6],
            createdAt: now,
            modifiedAt: now,
        });
        assert.strictEqual(store.getChunkCount(), 3);
        assert.strictEqual(store.getFileCount(), 2);
    });
    it("should clear all chunks", () => {
        const now = Date.now();
        store.upsertChunk({
            id: "c1",
            filePath: "/test/a.md",
            chunkIndex: 0,
            content: "Content 1",
            embedding: [0.1, 0.2],
            createdAt: now,
            modifiedAt: now,
        });
        store.clear();
        assert.strictEqual(store.getChunkCount(), 0);
    });
});
describe("Indexer utilities", () => {
    it("should chunk text correctly", () => {
        const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(50);
        const chunks = chunkText(text, 100, 20);
        assert.ok(chunks.length > 1);
        assert.strictEqual(chunks[0].content.length, 100);
        // Overlap should be present
        assert.strictEqual(chunks[1].charStart, 80); // 100 - 20 overlap
    });
    it("should handle text shorter than chunk size", () => {
        const chunks = chunkText("Short text", 500, 50);
        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].content, "Short text");
    });
    it("should generate deterministic file IDs", () => {
        const id1 = fileId("/path/to/file.md");
        const id2 = fileId("/path/to/file.md");
        const id3 = fileId("/path/to/other.md");
        assert.strictEqual(id1, id2);
        assert.notStrictEqual(id1, id3);
    });
    it("should generate deterministic chunk IDs", () => {
        const id1 = chunkId("/path/to/file.md", 0);
        const id2 = chunkId("/path/to/file.md", 0);
        const id3 = chunkId("/path/to/file.md", 1);
        assert.strictEqual(id1, id2);
        assert.notStrictEqual(id1, id3);
    });
    it("should generate file hashes that detect changes", () => {
        const hash1 = generateFileHash("Hello world");
        const hash2 = generateFileHash("Hello world");
        const hash3 = generateFileHash("Hello world!");
        assert.strictEqual(hash1, hash2);
        assert.notStrictEqual(hash1, hash3);
    });
});
//# sourceMappingURL=indexer.test.js.map