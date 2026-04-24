import {
  type EmbeddingsClient,
  chunkText,
} from "./lmstudio.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  Logger,
} from "./types.js";

// =============================================================================
// LanceDB Store
// =============================================================================

export interface StoreConfig {
  dataDir: string;
  logger: Logger;
}

export interface Store {
  store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry>;
  search(vector: number[], limit?: number, minScore?: number): Promise<MemorySearchResult[]>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  isInitialized(): boolean;
}

// Lazy-load LanceDB to avoid requiring it when not needed
async function loadLanceDb() {
  const module = await import("vectordb");
  return module;
}

export async function createStore(
  embeddings: EmbeddingsClient,
  config: StoreConfig,
): Promise<Store> {
  const { dataDir, logger } = config;

  let table: Awaited<ReturnType<ReturnType<typeof import("vectordb")>["LanceTable"]>> | null = null;
  let initialized = false;

  async function ensureInitialized() {
    if (initialized) return;
    initialized = true;

    const vectordb = await loadLanceDb();
    const dir = dataDir;

    // Create table with schema matching MemoryEntry
    table = await vectordb
      .table("memory_entries", {
        id: "uuid",
        text: "string",
        vector: "vector[float]",
        importance: "float",
        category: "string",
        agentId: "string?",
        tags: "string[]?",
        createdAt: "int64",
      })
      .create(dir, {
        dimension: await getEmbeddingDimension(embeddings),
        mode: "create",
      });

    logger.info?.(`store: initialized at ${dir}`);
  }

  async function getEmbeddingDimension(embeddings: EmbeddingsClient): Promise<number> {
    // Probe with a short text to get embedding dimension
    try {
      const vec = await embeddings.embed("dimension probe");
      return vec.length;
    } catch (err) {
      throw new Error(`store: failed to probe embedding dimension: ${String(err)}`);
    }
  }

  return {
    isInitialized() {
      return initialized;
    },

    async store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
      await ensureInitialized();

      // Embed text chunks and store each as separate entry
      const chunks = chunkText(entry.text);
      const created: MemoryEntry[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const fullEntry: MemoryEntry = {
          ...entry,
          id: crypto.randomUUID(),
          text: chunks.length > 1 ? `[chunk ${i + 1}/${chunks.length}] ${chunk}` : chunk,
          createdAt: Date.now(),
        };

        await table!.add([fullEntry]);
        created.push(fullEntry);
      }

      return created[0];
    },

    async search(vector: number[], limit = 5, minScore = 0.5): Promise<MemorySearchResult[]> {
      await ensureInitialized();

      const results = await table!.vectorSearch(vector).limit(limit).toArray();

      const mapped = results.map((row) => {
        const distance = (row as Record<string, unknown>)._distance as number ?? 0;
        const score = 1 / (1 + distance);
        return {
          entry: {
            id: (row as Record<string, unknown>).id as string,
            text: (row as Record<string, unknown>).text as string,
            vector: (row as Record<string, unknown>).vector as number[],
            importance: (row as Record<string, unknown>).importance as number,
            category: (row as Record<string, unknown>).category as MemoryEntry["category"],
            agentId: (row as Record<string, unknown>).agentId as string | undefined,
            tags: (row as Record<string, unknown>).tags as string[] | undefined,
            createdAt: (row as Record<string, unknown>).createdAt as number,
          },
          score,
        };
      });

      return mapped.filter((r) => r.score >= minScore);
    },

    async delete(id: string): Promise<boolean> {
      await ensureInitialized();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        throw new Error(`store: invalid memory ID format: ${id}`);
      }
      await table!.delete(`id = '${id}'`);
      return true;
    },

    async count(): Promise<number> {
      await ensureInitialized();
      return table!.countRows();
    },
  };
}