/**
 * Integration test for the per-agent memory plugin.
 *
 * Tests:
 * 1. Embedder calls LM Studio API at localhost:1234
 * 2. FAISS index builds from embeddings
 * 3. Search returns results from the index
 *
 * Prerequisites:
 * - LM Studio running at localhost:1234 with model "text-embedding-qwen3-embedding-4b" loaded
 * - Or set LM_STUDIO_URL to point to a running instance
 */
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
// Use temp test data dir
const TEST_DIR = join(__dirname, "../test-data");
const AGENT_ID = "test-agent";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sleep(_ms) {
    return new Promise((resolve) => setTimeout(resolve, _ms));
}
async function main() {
    console.log("=== Per-Agent Memory Plugin Integration Test ===\n");
    // Clean up any previous test run
    try {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
    catch { /* ignore */ }
    // ── 1. Plugin initialization ──────────────────────────────────────────
    console.log("1. Testing plugin initialization...");
    const { initPlugin } = await import("../plugin.js");
    const plugin = await initPlugin(AGENT_ID, __dirname);
    console.log(`   ✓ Plugin initialized for agent: ${plugin.agentId}`);
    // ── 2. Embedder: add a memory (calls LM Studio) ───────────────────────
    console.log("\n2. Testing embedder (LM Studio call)...");
    const testTexts = [
        "Rafe likes espresso and cold brew coffee",
        "Marcus prefers green tea with jasmine",
        "The project deadline is next Friday",
    ];
    const added = [];
    for (const text of testTexts) {
        const { id } = await plugin.add(text, ["test"], "integration-test");
        added.push(id);
        console.log(`   ✓ Added memory "${text.substring(0, 40)}..." → id: ${id}`);
    }
    // ── 3. FAISS index: verify index size ─────────────────────────────────
    console.log("\n3. Testing FAISS index build...");
    const stats = plugin.stats();
    console.log(`   ✓ Index size: ${stats.indexSize} (expected ${testTexts.length})`);
    if (stats.indexSize !== testTexts.length) {
        throw new Error(`Index size mismatch: expected ${testTexts.length}, got ${stats.indexSize}`);
    }
    // ── 4. Search: query returns results ───────────────────────────────────
    console.log("\n4. Testing semantic search...");
    // Search for coffee-related content
    const coffeeResults = await plugin.search("coffee drinks", 2);
    console.log(`   ✓ Search "coffee drinks" → ${coffeeResults.length} results`);
    for (const r of coffeeResults) {
        console.log(`     - [${r.score.toFixed(4)}] "${r.text.substring(0, 50)}"`);
    }
    if (coffeeResults.length === 0) {
        throw new Error("Search returned no results — expected at least 1");
    }
    // Search for project-related content
    const projectResults = await plugin.search("project deadline", 2);
    console.log(`   ✓ Search "project deadline" → ${projectResults.length} results`);
    for (const r of projectResults) {
        console.log(`     - [${r.score.toFixed(4)}] "${r.text.substring(0, 50)}"`);
    }
    // ── 5. Remember: retrieve a specific memory ───────────────────────────
    console.log("\n5. Testing remember (direct lookup)...");
    const firstId = added[0];
    const remembered = plugin.remember(firstId);
    if (!remembered)
        throw new Error(`Failed to remember id ${firstId}`);
    console.log(`   ✓ Remembered: "${remembered.text.substring(0, 50)}..."`);
    // ── 6. Recent memories ─────────────────────────────────────────────────
    console.log("\n6. Testing getRecent...");
    const recent = plugin.getRecent(5);
    console.log(`   ✓ getRecent returned ${recent.length} items`);
    if (recent.length !== testTexts.length) {
        throw new Error(`Expected ${testTexts.length} recent items, got ${recent.length}`);
    }
    // ── 7. Forget ───────────────────────────────────────────────────────────
    console.log("\n7. Testing forget...");
    const removed = await plugin.forget(added[0]);
    console.log(`   ✓ Forget(${added[0]}) → ${removed}`);
    if (!removed)
        throw new Error("Forget returned false");
    const statsAfter = plugin.stats();
    console.log(`   ✓ Index size after forget: ${statsAfter.indexSize} (expected ${testTexts.length - 1})`);
    // ── 8. Backup now ───────────────────────────────────────────────────────
    console.log("\n8. Testing backupNow...");
    plugin.backupNow();
    console.log("   ✓ backupNow() completed without error");
    // ── 9. Shutdown ────────────────────────────────────────────────────────
    console.log("\n9. Testing shutdown...");
    plugin.shutdown();
    console.log("   ✓ Shutdown completed");
    // ── Summary ─────────────────────────────────────────────────────────────
    console.log("\n=== All tests passed! ===\n");
    // Cleanup
    try {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
    catch { /* ignore */ }
}
main().catch((err) => {
    console.error(`\n❌ Test failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
//# sourceMappingURL=integration.test.js.map