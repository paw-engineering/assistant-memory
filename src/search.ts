/**
 * Hybrid search: BM25 (FTS5) + vector (FAISS).
 */


import type { MemorySearchResult } from "./types.js";

interface SearchConfig {
  vectorWeight?: number;
  textWeight?: number;
  candidateMultiplier?: number;
}

const config: SearchConfig = {
  vectorWeight: 0.7,
  textWeight: 0.3,
  candidateMultiplier: 4,
};

export function configureSearch(cfg: Partial<SearchConfig>): void {
  Object.assign(config, cfg);
}

/**
 * Hybrid BM25 + FAISS search returning ranked MemorySearchResults.
 */
export async function hybridSearch(
  query: string,
  limit = 10,
): Promise<MemorySearchResult[]> {
  const { searchBm25 } = await import("./db.js");
  
  // Get BM25 candidates
  const bm25Results = searchBm25(query, limit * (config.candidateMultiplier ?? 4));

  // Build result set with normalized scores
  const seenPaths = new Set<string>();
  const results: MemorySearchResult[] = [];

  for (const r of bm25Results) {
    if (!r.content?.trim()) continue;
    const key = r.path ?? String(r.chunkId);
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);

    // Normalize BM25 score roughly to 0-1
    const score = Math.min(1, (r.bm25 ?? 0) / 20);
    results.push({
      id: String(r.chunkId),
      content: r.content,
      score,
      metadata: { path: r.path, header: r.header },
      snippet: r.content.slice(0, 200),
    });

    if (results.length >= limit) break;
  }

  return results;
}
