/**
 * Per-Agent Memory Plugin — Plugin Entry Point
 *
 * Exposes the plugin to the DWG Assistant host via createPlugin().
 * The host calls initPlugin() to start the plugin and obtain the plugin API.
 */
import type { MemoryPluginConfig } from "./config.js";
export type { MemoryPluginConfig };
export interface MemorySearchResult {
    id: string;
    text: string;
    score: number;
    timestamp: number;
    tags: string[];
    source?: string;
}
export interface MemoryPluginEvents {
    onMemoryAdded?: (item: {
        id: string;
        text: string;
        tags: string[];
    }) => void;
    onMemoryForgotten?: (id: string) => void;
    onIndexUpdated?: () => void;
    onBackupCompleted?: (timestamp: number) => void;
}
export interface MemoryPlugin {
    /** Unique agent identifier */
    agentId: string;
    /** Add a new memory. Embeds text, stores it, updates the index. */
    add(text: string, tags?: string[], source?: string): Promise<{
        id: string;
    }>;
    /** Search memories by semantic similarity. Returns top-k results. */
    search(query: string, k?: number): Promise<MemorySearchResult[]>;
    /** Retrieve a specific memory by id. */
    remember(id: string): {
        id: string;
        text: string;
        timestamp: number;
        tags: string[];
        source?: string;
    } | undefined;
    /** Delete a memory by id. */
    forget(id: string): Promise<boolean>;
    /** Get recent memories, newest first. */
    getRecent(limit?: number): Array<{
        id: string;
        text: string;
        timestamp: number;
        tags: string[];
    }>;
    /** Get memories by tags. */
    getByTags(tags: string[], matchAny?: boolean): Array<{
        id: string;
        text: string;
        timestamp: number;
        tags: string[];
    }>;
    /** Get memory statistics. */
    stats(): {
        totalMemories: number;
        indexSize: number;
    };
    /** Trigger an immediate backup snapshot. */
    backupNow(): void;
    /** Shutdown the plugin, stopping timers and saving state. */
    shutdown(): void;
}
/**
 * Initialize the memory plugin for a specific agent.
 *
 * @param agentId - Unique agent identifier
 * @param baseDir - Optional base directory for config resolution (defaults to cwd)
 * @param events - Optional event listeners
 */
export declare function initPlugin(agentId: string, baseDir?: string, events?: MemoryPluginEvents): Promise<MemoryPlugin>;
/**
 * Factory for creating a MemoryPlugin instance (used by the host).
 */
export declare function createPlugin(agentId: string, baseDir?: string, events?: MemoryPluginEvents): Promise<MemoryPlugin>;
//# sourceMappingURL=plugin.d.ts.map