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

export class Embedder {
  private lmStudioUrl: string;
  private embeddingModel: string;
  private embeddingDimension: number;
  private batchSize: number;

  constructor(config: EmbedderConfig) {
    this.lmStudioUrl = config.lmStudioUrl.replace(/\/$/, "");
    this.embeddingModel = config.embeddingModel;
    this.embeddingDimension = config.embeddingDimension;
    this.batchSize = config.batchSize ?? 32;
  }

  /**
   * Embed a single text string. Returns a normalized float vector.
   */
  async embedText(text: string): Promise<number[]> {
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

    const data = await response.json() as { data?: Array<{ embedding: number[] }> };
    const embedding = data.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("LM Studio returned no embedding in response");
    }

    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.embeddingDimension}, got ${embedding.length}`
      );
    }

    return embedding;
  }

  /**
   * Embed multiple texts in a single batch request. Returns embeddings in order.
   * Falls back to individual requests if the server doesn't support batching.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

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
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await this.embedText(text));
      }
      return results;
    }

    const data = await response.json() as { data?: Array<{ embedding: number[] }> };
    const embeddings = data.data ?? [];

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding batch size mismatch: expected ${texts.length}, got ${embeddings.length}`
      );
    }

    return embeddings.map((e) => e.embedding);
  }

  getDimension(): number {
    return this.embeddingDimension;
  }

  getModel(): string {
    return this.embeddingModel;
  }
}

/** Standalone query embedding (uses singleton embedder instance) */
export async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const embedder = new Embedder({
      lmStudioUrl: "http://192.168.64.1:1234/v1",
      embeddingModel: "text-embedding-qwen3-embedding-4b",
      embeddingDimension: 2560,
    });
    return await embedder.embedText(text);
  } catch {
    return null;
  }
}
