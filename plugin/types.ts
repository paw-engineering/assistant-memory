// =============================================================================
// Shared Types
// =============================================================================

export interface MemoryEntry {
  id: string;
  text: string;
  vector: number[];
  importance: number;
  category: "preference" | "fact" | "decision" | "learning" | "other";
  agentId?: string;
  tags?: string[];
  createdAt: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface AgentMemoryConfig {
  version: number;
  lmStudioUrl: string;
  lmStudioModel: string;
  backupInterval: number; // minutes, default 5
  indexStrategy: "on-change" | "on-change-plus-periodic";
  periodicInterval?: number; // minutes, default 30
  autoRecall?: boolean;
  autoCapture?: boolean;
  captureMaxChars?: number;
  backupDir?: string;
  dataDir?: string;
}

export interface BackupMetadata {
  timestamp: number;
  agentId: string;
  version: number;
  entryCount: number;
  modelVersion?: string;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_CONFIG: Required<AgentMemoryConfig> = {
  version: 1,
  lmStudioUrl: "http://192.168.64.1:1234/v1/embeddings",
  lmStudioModel: "text-embedding-qwen3-embedding-4b",
  backupInterval: 5,
  indexStrategy: "on-change-plus-periodic",
  periodicInterval: 30,
  autoRecall: false,
  autoCapture: false,
  captureMaxChars: 2000,
  backupDir: ".memory/backups",
  dataDir: ".memory",
};