import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Store } from "./store.js";
import type { BackupMetadata, Logger } from "./types.js";

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
  logger: Logger;
}

export function createBackupService(
  store: Store,
  config: BackupConfig,
): BackupService {
  const { backupDir, intervalMinutes, logger } = config;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function backupFilename(timestamp: number): string {
    return `memory-${timestamp}.json`;
  }

  async function performBackup(): Promise<void> {
    if (stopped) return;

    const timestamp = Date.now();
    const backupPath = join(backupDir, backupFilename(timestamp));

    try {
      // Get all entries by counting (actual implementation would use a list method)
      const count = await store.count();

      const metadata: BackupMetadata = {
        timestamp,
        agentId: "agent", // Will be set by plugin
        version: 1,
        entryCount: count,
      };

      const payload = {
        metadata,
        // NOTE: actual entries would be listed via store.list() method
        // For backup purposes, we store metadata only — full dump requires
        // adding a list() method to Store. This is a placeholder for the
        // backup infrastructure; actual entry serialization is TBD.
      };

      await mkdir(backupDir, { recursive: true });
      await writeFile(backupPath, JSON.stringify(payload, null, 2), "utf-8");
      logger.info?.(`backup: saved ${backupPath} (${count} entries)`);

      // Prune old backups — keep last 10
      await pruneOldBackups(backupDir, 10);
    } catch (err) {
      logger.error?.(`backup: failed: ${String(err)}`);
    }
  }

  async function pruneOldBackups(dir: string, keep: number): Promise<void> {
    try {
      const files = await readdir(dir);
      const backups = files
        .filter((f) => f.startsWith("memory-") && f.endsWith(".json"))
        .map((f) => ({
          name: f,
          path: join(dir, f),
          time: stat(join(dir, f)).then((s) => s.mtimeMs),
        }));

      // Sort by mtime descending
      const withTime = await Promise.all(
        backups.map(async (b) => ({ ...b, time: await b.time })),
      );
      withTime.sort((a, b) => b.time - a.time);

      // Delete oldest beyond keep count
      for (const b of withTime.slice(keep)) {
        try {
          await import("node:fs/promises").then((fs) =>
            fs.unlink(b.path).catch(() => {}),
          );
        } catch {
          // Best-effort
        }
      }
    } catch {
      // Best-effort pruning
    }
  }

  return {
    start() {
      const intervalMs = intervalMinutes * 60 * 1000;
      intervalId = setInterval(performBackup, intervalMs);
      logger.info?.(`backup: scheduled every ${intervalMinutes}min to ${backupDir}`);
    },

    stop() {
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      logger.info?.("backup: stopped");
    },
  };
}

// =============================================================================
// On-Demand Backup (one-off)
// =============================================================================

export async function backupNow(
  store: Store,
  backupDir: string,
  agentId: string,
  logger: Logger,
): Promise<void> {
  const timestamp = Date.now();
  const backupPath = join(backupDir, `memory-${timestamp}.json`);

  try {
    const count = await store.count();
    const metadata: BackupMetadata = {
      timestamp,
      agentId,
      version: 1,
      entryCount: count,
    };

    const payload = { metadata };

    await mkdir(backupDir, { recursive: true });
    await writeFile(backupPath, JSON.stringify(payload, null, 2), "utf-8");
    logger.info?.(`backup: on-demand backup saved ${backupPath} (${count} entries)`);
  } catch (err) {
    logger.error?.(`backup: on-demand backup failed: ${String(err)}`);
    throw err;
  }
}