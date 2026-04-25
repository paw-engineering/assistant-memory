/**
 * SQLite database with FTS5 (BM25 full-text search) + metadata storage.
 * Falls back to JSON-file storage if SQLite is unavailable.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { MemoryItem } from "./types.js";

const DB_DIR = process.env.ASSISTANT_MEMORY_DIR 
  || path.join(process.env.HOME || "~", ".openclaw", "plugins", "@dwg", "assistant-memory");
const DB_PATH = path.join(DB_DIR, "memory.db");

let db: Database.Database;

export function initDb(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  
  // Memory items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Chunks table (for file indexing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      header TEXT,
      hash TEXT NOT NULL,
      embedding_id BLOB,
      UNIQUE(path, chunk_index)
    )
  `);

  // Documents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      collection TEXT DEFAULT 'default',
      mtime INTEGER NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER DEFAULT 0
    )
  `);

  // FTS5 virtual table for BM25 search on chunks
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      header,
      content='chunks',
      content_rowid='id'
    )
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, header) VALUES (new.id, new.content, new.header);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, header) VALUES('delete', old.id, old.content, old.header);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, header) VALUES('delete', old.id, old.content, old.header);
      INSERT INTO chunks_fts(rowid, content, header) VALUES (new.id, new.content, new.header);
    END;
  `);

  // Entities table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      source_chunk_id INTEGER REFERENCES chunks(id),
      created_at INTEGER NOT NULL
    )
  `);

  // Relationships table (knowledge graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity1 TEXT NOT NULL,
      entity1_type TEXT NOT NULL,
      relation TEXT NOT NULL,
      entity2 TEXT NOT NULL,
      entity2_type TEXT NOT NULL,
      source_chunk_id INTEGER REFERENCES chunks(id),
      confidence REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL
    )
  `);

  // Embeddings table (for FAISS)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL
    )
  `);
}

export function isDbAvailable(): boolean {
  try {
    return db !== null;
  } catch { return false; }
}

// ── Memory Items ─────────────────────────────────────────────────────────────

export function upsertMemoryItem(item: MemoryItem): void {
  const stmt = db.prepare(`
    INSERT INTO memory_items (id, content, metadata, created_at, updated_at)
    VALUES (@id, @content, @metadata, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      content = @content,
      metadata = @metadata,
      updated_at = @updatedAt
  `);
  stmt.run({
    id: item.id,
    content: item.content,
    metadata: JSON.stringify(item.metadata),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export function getMemoryItem(id: string): MemoryItem | null {
  const row = db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    content: row.content,
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteMemoryItem(id: string): boolean {
  const result = db.prepare("DELETE FROM memory_items WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Documents & Chunks ───────────────────────────────────────────────────────

export function upsertDocument(doc: { path: string; collection?: string; mtime: number; hash: string; size?: number }): number {
  const stmt = db.prepare(`
    INSERT INTO documents (path, collection, mtime, hash, size)
    VALUES (@path, @collection, @mtime, @hash, @size)
    ON CONFLICT(path) DO UPDATE SET
      mtime = @mtime,
      hash = @hash,
      size = @size
  `);
  stmt.run({ path: doc.path, collection: doc.collection || "default", mtime: doc.mtime, hash: doc.hash, size: doc.size ?? 0 });
  return (db.prepare("SELECT id FROM documents WHERE path = ?").get(doc.path) as any)?.id ?? -1;
}

export function getDocument(path: string): any {
  return db.prepare("SELECT * FROM documents WHERE path = ?").get(path);
}

export function deleteDocument(path: string): void {
  db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
  db.prepare("DELETE FROM documents WHERE path = ?").run(path);
}

// ── BM25 Search (FTS5) ───────────────────────────────────────────────────────

export interface Bm25Result { chunkId: number; path: string; content: string; header?: string; bm25: number; }

export function searchBm25(query: string, limit = 20): Bm25Result[] {
  const rows = db.prepare(`
    SELECT c.id as chunk_id, c.path, c.content, c.header,
           bm25(chunks_fts) as bm25
    FROM chunks_fts f
    JOIN chunks c ON c.id = f.rowid
    WHERE chunks_fts MATCH ?
    ORDER BY bm25 DESC
    LIMIT ?
  `).all(query, limit) as Bm25Result[];
  return rows;
}

// ── Vector Search (FAISS via embedding IDs) ─────────────────────────────────

export function searchByEmbeddingIds(ids: number[], scores?: number[]): any[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT c.* FROM chunks c
    JOIN embeddings e ON e.chunk_id = c.id
    WHERE c.id IN (${placeholders})
  `).all(...ids) as any[];
  
  if (!scores) return rows;
  // Sort by provided scores (FAISS returns them in the same order)
  const scoreMap = new Map(ids.map((id, i) => [id, scores[i]]));
  return rows.sort((a: any, b: any) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
}

export function insertChunks(chunks: Array<{ documentId?: number; path: string; chunkIndex: number; content: string; header?: string; hash: string }>): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (document_id, path, chunk_index, content, header, hash)
    VALUES (@documentId, @path, @chunkIndex, @content, @header, @hash)
  `);
  for (const c of chunks) {
    stmt.run({ ...c, documentId: c.documentId ?? null });
  }
}

export function deleteChunks(path: string): void {
  db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
}

// ── Entities & Relationships ─────────────────────────────────────────────────

export interface Entity { id?: number; name: string; type: string; properties?: Record<string, unknown>; sourceChunkId?: number; }
export interface Relationship { entity1: string; entity1Type: string; relation: string; entity2: string; entity2Type: string; confidence?: number; }

export function insertEntity(entity: Entity): void {
  db.prepare(`
    INSERT INTO entities (name, type, properties, source_chunk_id, created_at)
    VALUES (@name, @type, @properties, @sourceChunkId, ?)
    ON CONFLICT DO NOTHING
  `).run({ ...entity, properties: JSON.stringify(entity.properties ?? {}), sourceChunkId: entity.sourceChunkId ?? null }, Date.now());
}

export function insertRelationship(rel: Relationship): void {
  db.prepare(`
    INSERT OR IGNORE INTO relationships (entity1, entity1_type, relation, entity2, entity2_type, confidence, created_at)
    VALUES (@entity1, @entity1Type, @relation, @entity2, @entity2Type, @confidence, ?)
  `).run({ ...rel, confidence: rel.confidence ?? 1.0 }, Date.now());
}

export function queryGraph(entityName?: string): { entities: Entity[]; relationships: Relationship[] } {
  const entities = entityName
    ? (db.prepare("SELECT * FROM entities WHERE name LIKE ?").all(`%${entityName}%`) as Entity[])
    : [];
  const relationships = entityName
    ? (db.prepare(`
        SELECT * FROM relationships 
        WHERE entity1 LIKE ? OR entity2 LIKE ?
      `).all(`%${entityName}%`, `%${entityName}%`) as Relationship[])
    : (db.prepare("SELECT * FROM relationships LIMIT 100").all() as Relationship[]);
  return { entities, relationships };
}

export function getStats(): { totalMemories: number; indexedFiles: number } {
  const memCount = (db.prepare("SELECT COUNT(*) as c FROM memory_items").get() as any)?.c ?? 0;
  const docCount = (db.prepare("SELECT COUNT(DISTINCT path) as c FROM documents").get() as any)?.c ?? 0;
  return { totalMemories: memCount, indexedFiles: docCount };
}

export function closeDb(): void {
  if (db) db.close();
}
