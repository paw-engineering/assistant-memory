import { describe, it } from "node:test";
import assert from "node:assert";
import { chunkText, fileId, chunkId, generateFileHash } from "../src/chunker.js";
describe("chunker - chunkText", () => {
    it("should chunk text correctly with default settings", () => {
        const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(50);
        const chunks = chunkText(text);
        assert.ok(chunks.length > 1);
        assert.strictEqual(chunks[0].content.length, 500);
        // Overlap: second chunk starts at 500-50=450, but content wraps at end
        assert.ok(chunks[1].charStart < chunks[0].charEnd);
    });
    it("should handle text shorter than chunk size", () => {
        const chunks = chunkText("Short text", 500, 50);
        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].content, "Short text");
    });
    it("should handle empty text", () => {
        const chunks = chunkText("", 500, 50);
        assert.strictEqual(chunks.length, 0);
    });
    it("should respect custom chunk size and overlap", () => {
        const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(20);
        const chunks = chunkText(text, 100, 20);
        assert.ok(chunks.length > 1);
        assert.strictEqual(chunks[0].content.length, 100);
        assert.strictEqual(chunks[1].charStart, 80); // 100 - 20 overlap
    });
    it("should set correct indices", () => {
        const chunks = chunkText("ABCDEFGHIJ".repeat(100), 100, 20);
        for (let i = 0; i < chunks.length; i++) {
            assert.strictEqual(chunks[i].index, i);
        }
    });
});
describe("chunker - fileId", () => {
    it("should generate deterministic IDs", () => {
        const id1 = fileId("/path/to/file.md");
        const id2 = fileId("/path/to/file.md");
        assert.strictEqual(id1, id2);
    });
    it("should generate different IDs for different paths", () => {
        const id1 = fileId("/path/to/file.md");
        const id3 = fileId("/path/to/other.md");
        assert.notStrictEqual(id1, id3);
    });
    it("should start with 'file_' prefix", () => {
        const id = fileId("/path/to/file.md");
        assert.ok(id.startsWith("file_"));
    });
});
describe("chunker - chunkId", () => {
    it("should combine file ID and chunk index", () => {
        const id1 = chunkId("/path/to/file.md", 0);
        const id2 = chunkId("/path/to/file.md", 0);
        const id3 = chunkId("/path/to/file.md", 1);
        assert.strictEqual(id1, id2);
        assert.notStrictEqual(id1, id3);
        assert.ok(id3.endsWith("_1"));
    });
});
describe("chunker - generateFileHash", () => {
    it("should generate deterministic hashes", () => {
        const hash1 = generateFileHash("Hello world");
        const hash2 = generateFileHash("Hello world");
        assert.strictEqual(hash1, hash2);
    });
    it("should detect content changes", () => {
        const hash1 = generateFileHash("Hello world");
        const hash3 = generateFileHash("Hello world!");
        assert.notStrictEqual(hash1, hash3);
    });
    it("should handle empty content", () => {
        const hash = generateFileHash("");
        assert.strictEqual(typeof hash, "string");
        assert.ok(hash.length > 0);
    });
});
//# sourceMappingURL=chunker.test.js.map