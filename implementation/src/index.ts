import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

// =============================================================================
// Types
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
  backupInterval: number;
  indexStrategy: "on-change" | "on-change-plus-periodic";
  periodicInterval?: number;
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

export interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

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

// =============================================================================
// Config Loading
// =============================================================================

// Minimal validator (no external deps for portability)
function validateConfig(raw: unknown): asserts raw is Partial<AgentMemoryConfig> {
  if (!raw || typeof raw !== "object") throw new Error("config must be an object");
}

export async function loadConfig(configPath: string): Promise<AgentMemoryConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    throw new Error(`config file not found: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config file is not valid JSON: ${configPath}`);
  }

  validateConfig(parsed);

  return {
    ...DEFAULT_CONFIG,
    ...(parsed as Partial<AgentMemoryConfig>),
  };
}

export function resolveDataDir(baseDir: string, config: AgentMemoryConfig): string {
  return resolve(baseDir, config.dataDir ?? DEFAULT_CONFIG.dataDir);
}

export function resolveBackupDir(baseDir: string, config: AgentMemoryConfig): string {
  return resolve(baseDir, config.backupDir ?? DEFAULT_CONFIG.backupDir);
}

// =============================================================================
// Store Interface
// =============================================================================

export interface Store {
  store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry>;
  search(vector: number[], limit: number, minScore?: number): Promise<MemorySearchResult[]>;
  delete(id: string): Promise<void>;
  update(id: string, text: string, importance?: number): Promise<MemoryEntry>;
  count(): Promise<number>;
  list(): Promise<MemoryEntry[]>;
}

// =============================================================================
// In-Memory Store (simple implementation for portability)
// FAISS index stored on disk; entries in JSON file
// =============================================================================

interface StoredEntry extends Omit<MemoryEntry, "vector"> {
  vector: string; // stored as base64-ish string for JSON serialization
}

const ENTRIES_FILE = "entries.json";

function encodeVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString("base64");
}

function decodeVector(s: string): number[] {
  return Array.from(new Float32Array(Buffer.from(s, "base64").buffer));
}

function uuid(): string {
  return randomUUID();
}

export interface StoreConfig {
  dataDir: string;
  logger?: Logger;
}

export async function createStore(
  embeddings: EmbeddingsClient,
  config: StoreConfig,
): Promise<Store> {
  const { dataDir, logger } = config;
  await mkdir(dataDir, { recursive: true });

  const entriesPath = join(dataDir, ENTRIES_FILE);

  async function loadEntries(): Promise<MemoryEntry[]> {
    try {
      const raw = await readFile(entriesPath, "utf-8");
      const stored: StoredEntry[] = JSON.parse(raw);
      return stored.map((e) => ({ ...e, vector: decodeVector(e.vector) }));
    } catch {
      return [];
    }
  }

  async function saveEntries(entries: MemoryEntry[]): Promise<void> {
    const stored: StoredEntry[] = entries.map((e) => ({
      ...e,
      vector: encodeVector(e.vector),
    }));
    await writeFile(entriesPath, JSON.stringify(stored, null, 2), "utf-8");
  }

  return {
    async store(input) {
      const entries = await loadEntries();
      const entry: MemoryEntry = {
        ...input,
        id: uuid(),
        createdAt: Date.now(),
      };
      entries.push(entry);
      await saveEntries(entries);
      logger?.debug?.(`store: added entry ${entry.id}`);
      return entry;
    },

    async search(vector, limit, minScore = 0.3) {
      const entries = await loadEntries();
      // Simple cosine similarity
      const scored = entries.map((e) => {
        const dot = vector.reduce((s, v, i) => s + v * (e.vector[i] ?? 0), 0);
        const normA = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
        const normB = Math.sqrt(e.vector.reduce((s, v) => s + v * v, 0));
        const score = dot / (normA * normB + 1e-10);
        return { entry: e, score };
      });

      return scored
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    async delete(id) {
      const entries = await loadEntries();
      const filtered = entries.filter((e) => e.id !== id);
      await saveEntries(filtered);
      logger?.debug?.(`store: deleted entry ${id}`);
    },

    async update(id, text, importance) {
      const vector = await embeddings.embed(text);
      const entries = await loadEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`entry not found: ${id}`);
      entries[idx] = { ...entries[idx], text, vector, importance: importance ?? entries[idx].importance };
      await saveEntries(entries);
      return entries[idx];
    },

    async count() {
      const entries = await loadEntries();
      return entries.length;
    },

    async list() {
      return loadEntries();
    },
  };
}

// =============================================================================
// Embeddings Client
// =============================================================================

export interface EmbeddingsClient {
  embed(text: string): Promise<number[]>;
  isAvailable(): Promise<boolean>;
  model(): string;
}

export interface LmStudioConfig {
  url: string;
  model: string;
  logger?: Logger;
  maxRetries?: number;
  retryDelayMs?: number;
}

export function createLmStudioClient(config: LmStudioConfig): EmbeddingsClient {
  const { url, model, logger, maxRetries = 3, retryDelayMs = 2000 } = config;

  async function callWithRetry(text: string, attempt = 0): Promise<number[]> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`LM Studio returned ${response.status}`);
      }

      const json = await response.json() as { data?: { embedding?: number[] }[] };
      const embedding = json?.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid embedding response format");
      }
      return embedding;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      const delay = retryDelayMs * Math.pow(2, attempt);
      logger?.warn?.(`lmstudio: embedding failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callWithRetry(text, attempt + 1);
    }
  }

  return {
    async embed(text) { return callWithRetry(text); },

    async isAvailable() {
      try {
        const base = url.replace("/v1/embeddings", "");
        const response = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
      } catch { return false; }
    },

    model() { return model; },
  };
}

// =============================================================================
// Text Chunking
// =============================================================================

export function chunkText(text: string, maxChars = 2000): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChars) {
      current += (current ? "\n\n" : "") + para;
    } else {
      if (current) chunks.push(current);
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

// =============================================================================
// Backup Service
// =============================================================================

export interface BackupService {
  start(): void;
  stop(): void;
}

export interface BackupConfig {
  backupDir: string;
  intervalMinutes: number;
  logger?: Logger;
}

export function createBackupService(
  store: Store,
  config: BackupConfig,
): BackupService {
  const { backupDir, intervalMinutes, logger } = config;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function performBackup(): Promise<void> {
    if (stopped) return;
    const timestamp = Date.now();
    const backupPath = join(backupDir, `memory-${timestamp}.json`);

    try {
      const entries = await store.list();
      const metadata: BackupMetadata = {
        timestamp,
        agentId: "agent",
        version: 1,
        entryCount: entries.length,
      };

      await mkdir(backupDir, { recursive: true });
      await writeFile(backupPath, JSON.stringify({ metadata, entries }, null, 2), "utf-8");
      logger?.info?.(`backup: saved ${backupPath} (${entries.length} entries)`);

      // Prune — keep last 10
      await pruneOldBackups(backupDir, 10);
    } catch (err) {
      logger?.error?.(`backup: failed: ${String(err)}`);
    }
  }

  async function pruneOldBackups(dir: string, keep: number): Promise<void> {
    try {
      const files = await readdir(dir);
      const backups = files
        .filter((f) => f.startsWith("memory-") && f.endsWith(".json"))
        .map(async (f) => ({ name: f, path: join(dir, f), mtime: (await stat(join(dir, f))).mtimeMs }))
        .map(async (p) => ({ path: (await p).path, mtime: (await p).mtime }));

      const withTime = await Promise.all(backups);
      withTime.sort((a, b) => b.mtime - a.mtime);

      for (const b of withTime.slice(keep)) {
        try { await unlink(b.path); } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  }

  return {
    start() {
      const intervalMs = intervalMinutes * 60 * 1000;
      intervalId = setInterval(performBackup, intervalMs);
      logger?.info?.(`backup: scheduled every ${intervalMinutes}min to ${backupDir}`);
    },
    stop() {
      stopped = true;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      logger?.info?.("backup: stopped");
    },
  };
}

export async function backupNow(
  store: Store,
  backupDir: string,
  agentId: string,
  logger?: Logger,
): Promise<void> {
  const timestamp = Date.now();
  const backupPath = join(backupDir, `memory-${timestamp}.json`);

  try {
    const entries = await store.list();
    const metadata: BackupMetadata = { timestamp, agentId, version: 1, entryCount: entries.length };

    await mkdir(backupDir, { recursive: true });
    await writeFile(backupPath, JSON.stringify({ metadata, entries }, null, 2), "utf-8");
    logger?.info?.(`backup: on-demand saved ${backupPath} (${entries.length} entries)`);
  } catch (err) {
    logger?.error?.(`backup: on-demand failed: ${String(err)}`);
    throw err;
  }
}

// =============================================================================
// Memory Service — main API
// =============================================================================

export interface MemoryService {
  // CRUD
  add(text: string, importance?: number, category?: MemoryEntry["category"], tags?: string[]): Promise<MemoryEntry>;
  search(query: string, limit?: number, minScore?: number): Promise<MemorySearchResult[]>;
  delete(idOrQuery: string, byId?: boolean): Promise<{ deleted: number; ids: string[] }>;
  update(id: string, text: string, importance?: number): Promise<MemoryEntry>;

  // Utility
  count(): Promise<number>;
  list(): Promise<MemoryEntry[]>;
  backup(): Promise<void>;

  // Lifecycle
  start(): void;
  stop(): void;

  // Version
  version(): string;
}

export interface MemoryServiceConfig {
  baseDir: string;
  config: AgentMemoryConfig;
  logger?: Logger;
}

export function createMemoryService(
  embeddings: EmbeddingsClient,
  store: Store,
  backupService: BackupService,
  config: AgentMemoryConfig,
  logger?: Logger,
): MemoryService {
  return {
    async add(text, importance = 0.7, category = "other", tags) {
      const vector = await embeddings.embed(text);
      return store.store({ text, vector, importance, category, tags });
    },

    async search(query, limit = 5, minScore = 0.3) {
      const vector = await embeddings.embed(query);
      return store.search(vector, limit, minScore);
    },

    async delete(idOrQuery, byId = false) {
      if (byId) {
        await store.delete(idOrQuery);
        return { deleted: 1, ids: [idOrQuery] };
      }

      // Search then delete
      const results = await this.search(idOrQuery, 10, 0.7);
      if (results.length === 0) return { deleted: 0, ids: [] };

      const ids = results.map((r) => r.entry.id);
      for (const id of ids) { await store.delete(id); }
      return { deleted: ids.length, ids };
    },

    async update(id, text, importance) {
      return store.update(id, text, importance);
    },

    async count() { return store.count(); },
    async list() { return store.list(); },
    async backup() { await backupNow(store, resolveBackupDir(".", config), "agent", logger); },

    start() { backupService.start(); logger?.info?.("memory service: started"); },
    stop() { backupService.stop(); logger?.info?.("memory service: stopped"); },

    version() { return "1.0.0"; },
  };
}

// =============================================================================
// Factory
// =============================================================================

export async function createMemoryServiceFromConfig(
  configPath: string,
  baseDir: string,
  logger?: Logger,
): Promise<MemoryService> {
  const config = await loadConfig(configPath);
  const dataDir = resolveDataDir(baseDir, config);
  const backupDir = resolveBackupDir(baseDir, config);

  const embeddings = createLmStudioClient({ url: config.lmStudioUrl, model: config.lmStudioModel, logger });
  const store = await createStore(embeddings, { dataDir, logger });
  const backupService = createBackupService(store, { backupDir, intervalMinutes: config.backupInterval, logger });

  return createMemoryService(embeddings, store, backupService, config, logger);
}