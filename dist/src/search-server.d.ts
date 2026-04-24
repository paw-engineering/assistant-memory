/**
 * Search server with hybrid BM25 + vector search.
 *
 * Exposes REST endpoints for searching agent memory:
 * - POST /search - hybrid search query
 * - GET /health - health check with DB verification
 * - GET /status - index status
 */
import { MemoryStore } from "./store.js";
export interface SearchResult {
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: "vector" | "bm25" | "hybrid";
}
export interface SearchResponse {
    results: SearchResult[];
    meta: {
        total: number;
        searchMs: number;
    };
}
export interface HealthResponse {
    status: "ok" | "degraded" | "down";
    dbOk: boolean;
    embedderOk: boolean;
    lastIndex: string | null;
}
export interface StatusResponse {
    indexedDocs: number;
    lastSync: string | null;
    collections: string[];
}
/**
 * HTTP search server with hybrid BM25 + vector scoring.
 */
export declare class SearchServer {
    private store;
    private port;
    constructor(store: MemoryStore, port?: number);
    /**
     * Start the HTTP server (called during testing).
     */
    start(): Promise<void>;
    /**
     * Stop the HTTP server.
     */
    stop(): Promise<void>;
    /**
     * Hybrid search combining vector similarity and BM25.
     */
    search(query: string, limit?: number): SearchResponse;
    /**
     * Health check with DB verification.
     */
    health(): HealthResponse;
    /**
     * Index status without actually querying the DB.
     */
    status(): StatusResponse;
    private scoreBM25;
    private mockVectorScore;
    private extractSnippet;
    private estimateLineNumber;
}
//# sourceMappingURL=search-server.d.ts.map