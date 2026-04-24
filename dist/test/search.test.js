import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { SearchServer } from "../src/search-server.js";
import { MemoryStore } from "../src/store.js";
import { tempfile, cleanupTempDir } from "./helpers.js";
describe("SearchServer", () => {
    let store;
    let server;
    let tempDir;
    let abortController;
    beforeEach(() => {
        tempDir = tempfile();
        store = new MemoryStore(tempDir);
        abortController = new AbortController();
    });
    afterEach(() => {
        server.stop();
        cleanupTempDir(tempDir);
    });
    it("should start and stop without errors", () => {
        server = new SearchServer(store, 19999);
        server.start();
        server.stop();
    });
    it("should respond to health check", async () => {
        server = new SearchServer(store, 19998);
        server.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await fetch("http://localhost:19998/health");
        const json = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(json.status, "ok");
        server.stop();
    });
    it("should return empty results for empty index", async () => {
        server = new SearchServer(store, 19997);
        server.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await fetch("http://localhost:19997/search?q=test");
        const json = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(json.query, "test");
        assert.strictEqual(json.topK, 0);
        assert.deepStrictEqual(json.results, []);
        server.stop();
    });
    it("should return search results", async () => {
        // Add some chunks to the store
        const now = Date.now();
        store.upsertChunk({
            id: "chunk_1",
            filePath: "/test/a.md",
            chunkIndex: 0,
            content: "Apple is a fruit",
            embedding: [1, 0, 0],
            createdAt: now,
            modifiedAt: now,
        });
        store.upsertChunk({
            id: "chunk_2",
            filePath: "/test/b.md",
            chunkIndex: 0,
            content: "Banana is also fruit",
            embedding: [0, 1, 0],
            createdAt: now,
            modifiedAt: now,
        });
        server = new SearchServer(store, 19996);
        server.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await fetch("http://localhost:19996/search?q=fruit&k=2");
        const json = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(json.query, "fruit");
        assert.strictEqual(json.topK, 2);
        assert.strictEqual(json.results.length, 2);
        server.stop();
    });
    it("should return stats", async () => {
        const now = Date.now();
        store.upsertChunk({
            id: "chunk_1",
            filePath: "/test/a.md",
            chunkIndex: 0,
            content: "Test content",
            embedding: [0.1, 0.2],
            createdAt: now,
            modifiedAt: now,
        });
        server = new SearchServer(store, 19995);
        server.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await fetch("http://localhost:19995/stats");
        const json = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(json.fileCount, 1);
        assert.strictEqual(json.chunkCount, 1);
        server.stop();
    });
    it("should handle missing query parameter", async () => {
        server = new SearchServer(store, 19994);
        server.start();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await fetch("http://localhost:19994/search");
        const json = await response.json();
        assert.strictEqual(response.status, 400);
        assert.ok(json.error.includes("Missing query"));
        server.stop();
    });
});
//# sourceMappingURL=search.test.js.map