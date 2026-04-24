/**
 * LM Studio embedding client.
 *
 * Calls the LM Studio completions API:
 *   POST {url}/v1/embeddings
 * with model name in body.
 *
 * Returns a raw float array embedding, or throws on error.
 */
export class Embedder {
    lmStudioUrl;
    embeddingModel;
    embeddingDimension;
    batchSize;
    constructor(config) {
        this.lmStudioUrl = config.lmStudioUrl.replace(/\/$/, "");
        this.embeddingModel = config.embeddingModel;
        this.embeddingDimension = config.embeddingDimension;
        this.batchSize = config.batchSize ?? 32;
    }
    /**
     * Embed a single text string. Returns a normalized float vector.
     */
    async embedText(text) {
        const body = {
            model: this.embeddingModel,
            input: text,
        };
        const response = await fetch(`${this.lmStudioUrl}/v1/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`LM Studio embedding failed (${response.status}): ${error}`);
        }
        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
            throw new Error("LM Studio returned no embedding in response");
        }
        if (embedding.length !== this.embeddingDimension) {
            throw new Error(`Embedding dimension mismatch: expected ${this.embeddingDimension}, got ${embedding.length}`);
        }
        return embedding;
    }
    /**
     * Embed multiple texts in a single batch request. Returns embeddings in order.
     * Falls back to individual requests if the server doesn't support batching.
     */
    async embedBatch(texts) {
        if (texts.length === 0)
            return [];
        const body = {
            model: this.embeddingModel,
            inputs: texts,
        };
        const response = await fetch(`${this.lmStudioUrl}/v1/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            // Fallback: embed one at a time
            const results = [];
            for (const text of texts) {
                results.push(await this.embedText(text));
            }
            return results;
        }
        const data = await response.json();
        const embeddings = data.data ?? [];
        if (embeddings.length !== texts.length) {
            throw new Error(`Embedding batch size mismatch: expected ${texts.length}, got ${embeddings.length}`);
        }
        return embeddings.map((e) => e.embedding);
    }
    getDimension() {
        return this.embeddingDimension;
    }
    getModel() {
        return this.embeddingModel;
    }
}
//# sourceMappingURL=embedder.js.map