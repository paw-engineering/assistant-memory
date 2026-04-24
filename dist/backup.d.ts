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
export declare class BackupManager {
    private dataDir;
    private backupDir;
    private maxBackups;
    private intervalMs;
    private timer;
    constructor(dataDir: string, backupDir: string, maxBackups?: number, intervalMs?: number);
    /**
     * Create a snapshot backup of the current memory data.
     * This is also called automatically by the scheduled backup.
     */
    snapshot(): void;
    /**
     * Start the automatic backup timer.
     */
    start(): void;
    /**
     * Stop the automatic backup timer.
     */
    stop(): void;
    /**
     * Remove old backups beyond maxBackups.
     */
    private prune;
    /**
     * List all available backups, newest-first.
     */
    list(): Array<{
        timestamp: number;
        path: string;
    }>;
    /**
     * Restore from a specific backup timestamp.
     * Overwrites current data with backup contents.
     */
    restore(timestamp: number): void;
}
//# sourceMappingURL=backup.d.ts.map