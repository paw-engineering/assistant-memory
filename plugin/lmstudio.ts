import { OpenAI } from "openai";
import type { Logger } from "./types.js";

// =============================================================================
// LM Studio Embeddings Client
// =============================================================================

export interface EmbeddingsClient {
  embed(text: string): Promise<number[]>;
  isAvailable(): Promise<boolean>;
  model(): string;
}

export interface LmStudioConfig {
  url: string;
  model: string;
  logger: Logger;
  maxRetries?: number;
  retryDelayMs?: number;
}

export function createLmStudioClient(config: LmStudioConfig): EmbeddingsClient {
  const { url, model, logger, maxRetries = 3, retryDelayMs = 2000 } = config;

  const client = new OpenAI({
    apiKey: "not-needed",
    baseURL: url,
  });

  async function callWithRetry(text: string, attempt = 0): Promise<number[]> {
    try {
      const response = await client.embeddings.create({
        model,
        input: text,
      });
      return response.data[0].embedding;
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = retryDelayMs * Math.pow(2, attempt);
      logger.warn?.(`lmstudio: embedding failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callWithRetry(text, attempt + 1);
    }
  }

  return {
    async embed(text: string): Promise<number[]> {
      return callWithRetry(text);
    },

    async isAvailable(): Promise<boolean> {
      try {
        // Lightweight health check — list models endpoint
        const response = await fetch(`${url.replace("/v1/embeddings", "")}/v1/models`, {
          signal: AbortSignal.timeout(3000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    model(): string {
      return model;
    },
  };
}

// =============================================================================
// Text Chunking (for long texts)
// =============================================================================

export function chunkText(text: string, maxChars = 2000): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  // Split on sentence/paragraph boundaries when possible
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChars) {
      current += (current ? "\n\n" : "") + para;
    } else {
      if (current) chunks.push(current);
      // If single paragraph exceeds limit, split by sentences
      if (para.length > maxChars) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        current = "";
        for (const sentence of sentences) {
          if (current.length + sentence.length + 1 <= maxChars) {
            current += (current ? " " : "") + sentence;
          } else {
            if (current) chunks.push(current);
            current = sentence.slice(0, maxChars);
          }
        }
      } else {
        current = para.slice(0, maxChars);
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}