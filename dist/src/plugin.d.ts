/**
 * OpenClaw IMemoryPlugin factory for assistant-memory.
 *
 * Usage:
 *   import { createPlugin } from '@dwg/assistant-memory';
 *   const plugin = await createPlugin({ agentId: 'programmer' });
 *   await plugin.start();
 */
import type { MemorySearchResult } from "./types.js";
import type { MemoryPluginConfig } from "./config.js";
export type { MemoryPluginConfig };
export interface CreatePluginOptions {
    agentId: string;
    baseDir?: string;
}
export interface MemoryPlugin {
    readonly name: string;
    readonly version: string;
    start(): Promise<void>;
    stop(): void;
    search(query: string, limit?: number): Promise<MemorySearchResult[]>;
    add(id: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
    remove(id: string): Promise<boolean>;
    getStats(): Promise<{
        count: number;
        lastIndexed: number | null;
    }>;
}
export declare function createPlugin(opts: CreatePluginOptions): Promise<MemoryPlugin>;
//# sourceMappingURL=plugin.d.ts.map