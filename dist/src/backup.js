/**
 * Periodic backup manager for memory data.
 *
 * Backs up:
 * - All JSON memory item files
 * - The FAISS index files
 * - The ID map
 *
 * Retention: keeps last N backups (default 3).
 * Backup is timestamped: {backupDir}/backup-{timestamp}/
 */
import { readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
export class BackupManager {
    dataDir;
    backupDir;
    maxBackups;
    intervalMs;
    timer = null;
    constructor(dataDir, backupDir, maxBackups = 3, intervalMs = 300_000) {
        this.dataDir = resolve(dataDir);
        this.backupDir = resolve(backupDir);
        this.maxBackups = maxBackups;
        this.intervalMs = intervalMs;
        mkdirSync(this.backupDir, { recursive: true });
    }
    /**
     * Create a snapshot backup of the current memory data.
     * This is also called automatically by the scheduled backup.
     */
    snapshot() {
        const timestamp = Date.now();
        const dir = join(this.backupDir, `backup-${timestamp}`);
        mkdirSync(dir, { recursive: true });
        // Backup memory item JSON files
        if (existsSync(this.dataDir)) {
            const files = readdirSync(this.dataDir).filter((f) => f.endsWith(".json"));
            for (const file of files) {
                const src = join(this.dataDir, file);
                const dst = join(dir, file);
                copyFileSync(src, dst);
            }
        }
        // Backup index files
        const indexFile = join(this.dataDir, "index.faiss");
        if (existsSync(indexFile)) {
            copyFileSync(indexFile, join(dir, "index.faiss"));
        }
        const idMapFile = join(this.dataDir, "index-ids.json");
        if (existsSync(idMapFile)) {
            copyFileSync(idMapFile, join(dir, "index-ids.json"));
        }
        // Write metadata
        writeFileSync(join(dir, "meta.json"), JSON.stringify({
            timestamp,
            dataDir: this.dataDir,
        }, null, 2), "utf-8");
        this.prune();
    }
    /**
     * Start the automatic backup timer.
     */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            try {
                this.snapshot();
                console.log(`[backup] Automatic backup completed at ${new Date().toISOString()}`);
            }
            catch (err) {
                console.error(`[backup] Automatic backup failed: ${err}`);
            }
        }, this.intervalMs);
    }
    /**
     * Stop the automatic backup timer.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /**
     * Remove old backups beyond maxBackups.
     */
    prune() {
        if (!existsSync(this.backupDir))
            return;
        const dirs = readdirSync(this.backupDir)
            .filter((d) => d.startsWith("backup-"))
            .map((d) => ({ name: d, timestamp: parseInt(d.replace("backup-", ""), 10) }))
            .filter((d) => !isNaN(d.timestamp))
            .sort((a, b) => b.timestamp - a.timestamp);
        for (let i = this.maxBackups; i < dirs.length; i++) {
            try {
                rmSync(join(this.backupDir, dirs[i].name), { recursive: true, force: true });
                console.log(`[backup] Pruned old backup: ${dirs[i].name}`);
            }
            catch { /* ignore */ }
        }
    }
    /**
     * List all available backups, newest-first.
     */
    list() {
        if (!existsSync(this.backupDir))
            return [];
        return readdirSync(this.backupDir)
            .filter((d) => d.startsWith("backup-"))
            .map((d) => {
            const timestamp = parseInt(d.replace("backup-", ""), 10);
            return { timestamp: isNaN(timestamp) ? 0 : timestamp, path: join(this.backupDir, d) };
        })
            .filter((b) => b.timestamp > 0)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
    /**
     * Restore from a specific backup timestamp.
     * Overwrites current data with backup contents.
     */
    restore(timestamp) {
        const backupPath = join(this.backupDir, `backup-${timestamp}`);
        if (!existsSync(backupPath)) {
            throw new Error(`Backup not found: backup-${timestamp}`);
        }
        // Copy all files from backup to data dir
        const files = ["index.faiss", "index-ids.json"];
        for (const file of files) {
            const src = join(backupPath, file);
            if (existsSync(src)) {
                const dst = join(this.dataDir, file);
                // Ensure dataDir exists
                mkdirSync(this.dataDir, { recursive: true });
                copyFileSync(src, dst);
            }
        }
        // Copy memory JSON files
        const backupFiles = readdirSync(backupPath).filter((f) => f.endsWith(".json"));
        for (const file of backupFiles) {
            const src = join(backupPath, file);
            const dst = join(this.dataDir, file);
            copyFileSync(src, dst);
        }
        console.log(`[backup] Restored from backup-${timestamp}`);
    }
}
//# sourceMappingURL=backup.js.map