/**
 * File indexing with watching and embedding cache.
 */

import { watch, type FSWatcher } from "chokidar";
import { readFileSync, statSync, existsSync } from "fs";
import { createHash } from "crypto";
import { relative } from "path";

interface IndexerOptions {
  watchDirs: string[];
  patterns?: string[];
}

let watcher: FSWatcher | null = null;

const DEFAULT_PATTERNS = ["**/*.md", "**/*.txt"];

// ── Hashing ─────────────────────────────────────────────────────────────────

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── Markdown chunking (header-aware) ────────────────────────────────────────

export function chunkMarkdown(text: string, maxChunkSize = 500, overlap = 50): Array<{ content: string; header?: string }> {
  const chunks: Array<{ content: string; header?: string }> = [];
  const lines = text.split("\n");
  let currentHeader = "";
  let currentLines: string[] = [];
  let size = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      if (currentLines.length > 0 && size > 0) {
        chunks.push({ content: currentLines.join("\n").trim(), header: currentHeader });
        const overlapCount = Math.floor(overlap / 20);
        const overlapLines = currentLines.slice(-overlapCount).join("\n");
        currentLines = overlapLines ? [overlapLines] : [];
        size = overlapLines.length;
      }
      currentHeader = headerMatch[2].trim();
    }

    currentLines.push(line);
    size += line.length + 1;

    if (size >= maxChunkSize) {
      const content = currentLines.join("\n").trim();
      if (content) chunks.push({ content, header: currentHeader });
      
      const overlapCount = Math.floor(overlap / 20);
      const overlapLines = currentLines.slice(-overlapCount).join("\n");
      currentLines = overlapLines ? [overlapLines] : [];
      size = overlapLines.length;
    }
  }

  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) chunks.push({ content, header: currentHeader });
  }

  return chunks;
}

// ── File content extraction ──────────────────────────────────────────────────

function extractContent(filePath: string): { content: string; mtime: number; hash: string } | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (stat.isDirectory()) return null;
    
    const raw = readFileSync(filePath, "utf-8");
    return { content: raw, mtime: stat.mtimeMs, hash: computeHash(raw) };
  } catch {
    return null;
  }
}

// ── Index a single file ─────────────────────────────────────────────────────

export async function indexFile(
  filePath: string,
  collection = "default"
): Promise<{ indexed: number; skipped: boolean }> {
  const { getDocument, upsertDocument, insertChunks, deleteChunks } = await import("./db.js");
  
  const info = extractContent(filePath);
  if (!info) return { indexed: 0, skipped: false };

  const existing = getDocument(filePath);
  if (existing && existing.hash === info.hash) {
    return { indexed: 0, skipped: true };
  }

  upsertDocument({ path: filePath, collection, mtime: info.mtime, hash: info.hash });
  deleteChunks(filePath);

  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!["md", "txt"].includes(ext ?? "")) {
    return { indexed: 0, skipped: false };
  }

  const chunks = chunkMarkdown(info.content);
  insertChunks(chunks.map((c, i) => ({
    path: filePath,
    chunkIndex: i,
    content: c.content,
    header: c.header,
    hash: computeHash(c.content),
  })));

  return { indexed: chunks.length, skipped: false };
}

// ── Re-index all files in directories ───────────────────────────────────────

export async function reindexAll(
  dirs: string[],
  patterns = DEFAULT_PATTERNS
): Promise<number> {
  const { globSync } = await import("glob");
  
  let totalChunks = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    for (const pattern of patterns) {
      try {
        // Use sync glob — simpler and safe for startup
        const files: string[] = globSync(pattern, { cwd: dir, ignore: ["**/node_modules/**", "**/.git/**"] });
        
        for (const file of files) {
          const result = await indexFile(file);
          if (!result.skipped) totalChunks += result.indexed;
        }
      } catch { /* skip pattern errors */ }
    }
  }

  return totalChunks;
}

// ── Watcher management ───────────────────────────────────────────────────────

export function startWatcher(opts: IndexerOptions): void {
  if (watcher) watcher.close();

  const { watchDirs, patterns = DEFAULT_PATTERNS } = opts;

  // Flatten patterns for chokidar (it handles glob internally)
  watcher = watch(watchDirs, {
    ignored: ["**/node_modules/**", "**/.git/**"],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const onEvent = async (filePath: string) => {
    try {
      const result = await indexFile(filePath);
      if (result.indexed > 0 || !result.skipped) {
        console.log(`[indexer] ${result.skipped ? "unchanged" : "indexed"}: ${relative(watchDirs[0], filePath)}`);
      }
    } catch (err) {
      console.error(`[indexer] Error indexing ${filePath}:`, err);
    }
  };

  watcher.on("add", onEvent);
  watcher.on("change", onEvent);

  watcher.on("unlink", async (filePath: string) => {
    try {
      const { deleteDocument } = await import("./db.js");
      deleteDocument(filePath);
      console.log(`[indexer] removed: ${relative(watchDirs[0], filePath)}`);
    } catch (err) {
      console.error(`[indexer] Error removing ${filePath}:`, err);
    }
  });

  watcher.on("error", (err) => console.error("[indexer] Watch error:", err));
  console.log(`[indexer] Watching ${watchDirs.length} directories`);
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
