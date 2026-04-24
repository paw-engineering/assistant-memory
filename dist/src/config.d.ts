/**
 * Configuration loading and validation for the memory plugin.
 */
export interface MemoryPluginConfig {
    /** Unique identifier for this agent (required) */
    agentId: string;
    /** Base directory for agent data (default: data/agents/{agentId}/memory) */
    dataDir?: string;
    /** LM Studio server URL */
    lmStudioUrl?: string;
    /** Embedding model name */
    embeddingModel?: string;
    /** Embedding vector dimension */
    embeddingDimension?: number;
    /** Batch size for embedding requests */
    batchSize?: number;
    /** Backup interval in ms (default: 5 minutes) */
    backupIntervalMs?: number;
    /** Maximum number of backups to keep */
    maxBackups?: number;
    /** Index rebuild interval in ms (default: 30 seconds) */
    indexUpdateIntervalMs?: number;
}
export declare const CONFIG_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly agentId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly dataDir: {
            readonly type: "string";
        };
        readonly lmStudioUrl: {
            readonly type: "string";
            readonly format: "uri";
        };
        readonly embeddingModel: {
            readonly type: "string";
        };
        readonly embeddingDimension: {
            readonly type: "number";
            readonly minimum: 1;
        };
        readonly batchSize: {
            readonly type: "number";
            readonly minimum: 1;
            readonly maximum: 256;
        };
        readonly backupIntervalMs: {
            readonly type: "number";
            readonly minimum: 60000;
        };
        readonly maxBackups: {
            readonly type: "number";
            readonly minimum: 1;
            readonly maximum: 20;
        };
        readonly indexUpdateIntervalMs: {
            readonly type: "number";
            readonly minimum: 5000;
        };
    };
    readonly required: readonly ["agentId"];
    readonly additionalProperties: false;
};
/**
 * Resolved defaults — merged in when config file is absent or fields are missing.
 */
export declare const CONFIG_DEFAULTS: {
    readonly lmStudioUrl: "http://localhost:1234/v1";
    readonly embeddingModel: "text-embedding-qwen3-embedding-4b";
    readonly embeddingDimension: 2560;
    readonly batchSize: 32;
    readonly backupIntervalMs: 300000;
    readonly maxBackups: 10;
    readonly indexUpdateIntervalMs: 30000;
};
/**
 * Resolve config file path for a given agent.
 * Searches in: config/agents/{agentId}/memory-plugin.json
 */
export declare function resolveConfigPath(agentId: string, baseDir?: string): string;
/**
 * Load and validate config for an agent.
 * Falls back to defaults for optional fields.
 */
export declare function loadConfig(agentId: string, baseDir?: string): MemoryPluginConfig;
/**
 * Validate config against the schema.
 * Throws if invalid.
 */
export declare function validateConfig(config: MemoryPluginConfig): void;
/**
 * Get the resolved data directory for an agent.
 */
export declare function resolveDataDir(config: MemoryPluginConfig): string;
//# sourceMappingURL=config.d.ts.map