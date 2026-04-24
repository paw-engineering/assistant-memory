/**
 * FAISS index wrapper for vector similarity search.
 *
 * Supports:
 * - Adding vectors with associated string IDs
 * - Similarity search by vector or raw text (auto-embeds)
 * - Saving/loading the index to disk
 * - ID tracking via a companion JSON file
 *
 * Uses faiss-node's IndexFlatL2 (exhaustive L2 search).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import faissNode from "faiss-node";
const { IndexFlatL2 } = faissNode;
/**
 * A FAISS IndexFlatL2 wrapper that tracks string IDs alongside vector data.
 * Saves index to {dataDir}/index.faiss and ID map to {dataDir}/index-ids.json.
 */
export class FaissIndex {
    dimension;
    index;
    ids = [];
    dataDir;
    idMapPath;
    constructor(dimension, dataDir) {
        this.dimension = dimension;
        this.dataDir = resolve(dataDir);
        this.idMapPath = join(this.dataDir, "index-ids.json");
        this.index = new IndexFlatL2(dimension);
    }
    /**
     * Get the next sequential integer ID for a new vector.
     */
    nextId() {
        return this.ids.length;
    }
    /**
     * Add a single text vector with its associated string ID.
     * faiss-node's add() takes a flat number[] of size n*d; we add one at a time.
     */
    add(id, embedding) {
        if (embedding.length !== this.dimension) {
            throw new Error(`Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`);
        }
        this.index.add(embedding);
        this.ids.push(id);
    }
    /**
     * Add multiple vectors at once.
     */
    addBatch(items) {
        for (const item of items) {
            this.add(item.id, item.embedding);
        }
    }
    /**
     * Search for the k nearest neighbors to the given embedding.
     */
    search(embedding, k) {
        const result = this.index.search(embedding, k);
        const searchResults = [];
        for (let i = 0; i < result.labels.length; i++) {
            const label = result.labels[i];
            if (label === -1)
                break; // FAISS returns -1 for invalid/padding slots
            const intId = Number(label);
            if (intId < 0 || intId >= this.ids.length)
                break;
            searchResults.push({
                id: this.ids[intId],
                score: result.distances[i],
            });
        }
        return searchResults;
    }
    /**
     * Get total number of vectors in the index.
     */
    size() {
        return this.ids.length;
    }
    /**
     * Clear all vectors and IDs by replacing with a fresh index.
     */
    reset() {
        this.index = new IndexFlatL2(this.dimension);
        this.ids = [];
    }
    /**
     * Save the index and ID map to disk.
     */
    save() {
        const indexPath = join(this.dataDir, "index.faiss");
        this.index.write(indexPath);
        writeFileSync(this.idMapPath, JSON.stringify(this.ids, null, 2), "utf-8");
    }
    /**
     * Load the index and ID map from disk.
     * If files do not exist, this is a no-op (empty index).
     */
    load() {
        const indexPath = join(this.dataDir, "index.faiss");
        if (!existsSync(indexPath) || !existsSync(this.idMapPath)) {
            return; // Fresh start — nothing to load
        }
        this.index = IndexFlatL2.read(indexPath);
        const loaded = JSON.parse(readFileSync(this.idMapPath, "utf-8"));
        this.ids = loaded;
    }
    /**
     * Rebuild the index from a fresh list of (id, embedding) pairs.
     * This replaces the current index entirely.
     */
    rebuild(items) {
        this.reset();
        for (const item of items) {
            this.add(item.id, item.embedding);
        }
    }
    /**
     * Get all tracked IDs.
     */
    getIds() {
        return [...this.ids];
    }
}
//# sourceMappingURL=faiss.js.map