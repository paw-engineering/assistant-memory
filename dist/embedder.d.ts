/**
 * LM Studio embedding client.
 *
 * Calls the LM Studio completions API:
 *   POST {url}/v1/embeddings
 * with model name in body.
 *
 * Returns a raw float array embedding, or throws on error.
 */
export interface EmbedderConfig {
    lmStudioUrl: string;
    embeddingModel: string;
    embeddingDimension: number;
    batchSize?: number;
}
export declare class Embedder {
    private lmStudioUrl;
    private embeddingModel;
    private embeddingDimension;
    private batchSize;
    constructor(config: EmbedderConfig);
    /**
     * Embed a single text string. Returns a normalized float vector.
     */
    embedText(text: string): Promise<number[]>;
    /**
     * Embed multiple texts in a single batch request. Returns embeddings in order.
     * Falls back to individual requests if the server doesn't support batching.
     */
    embedBatch(texts: string[]): Promise<number[][]>;
    getDimension(): number;
    getModel(): string;
}
//# sourceMappingURL=embedder.d.ts.map