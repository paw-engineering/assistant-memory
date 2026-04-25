// Shared types for assistant-memory

export interface MemoryConfig {
  agentId: string;
  dataDir?: string;
  lmStudioUrl?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  batchSize?: number;
  backupIntervalMs?: number;
  maxBackups?: number;
  indexUpdateIntervalMs?: number;
  watchDirs?: string[];
}

export interface MemoryItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  embedding?: number[];
}

export interface MemorySearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  snippet?: string;
}

export interface Chunk {
  id?: number;
  documentId: number;
  path: string;
  chunkIndex: number;
  content: string;
  header?: string;
  embedding?: number[];
  hash: string;
}

export interface Document {
  id?: number;
  path: string;
  collection: string;
  mtime: number;
  hash: string;
  size: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  minScore?: number;
  collection?: string;
  conversationContext?: string;
}
