/**
 * Configuration loading and validation for the memory plugin.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
// JSON Schema for plugin config validation
export const CONFIG_SCHEMA = {
    type: "object",
    properties: {
        agentId: { type: "string", minLength: 1 },
        dataDir: { type: "string" },
        lmStudioUrl: { type: "string", format: "uri" },
        embeddingModel: { type: "string" },
        embeddingDimension: { type: "number", minimum: 1 },
        batchSize: { type: "number", minimum: 1, maximum: 256 },
        backupIntervalMs: { type: "number", minimum: 60000 },
        maxBackups: { type: "number", minimum: 1, maximum: 20 },
        indexUpdateIntervalMs: { type: "number", minimum: 5000 },
    },
    required: ["agentId"],
    additionalProperties: false,
};
/**
 * Resolved defaults — merged in when config file is absent or fields are missing.
 */
export const CONFIG_DEFAULTS = {
    lmStudioUrl: "http://localhost:1234/v1",
    embeddingModel: "text-embedding-qwen3-embedding-4b",
    embeddingDimension: 2560,
    batchSize: 32,
    backupIntervalMs: 300_000,
    maxBackups: 10,
    indexUpdateIntervalMs: 30_000,
};
/**
 * Resolve config file path for a given agent.
 * Searches in: config/agents/{agentId}/memory-plugin.json
 */
export function resolveConfigPath(agentId, baseDir) {
    const base = baseDir ?? cwd();
    return resolve(base, "config", "agents", agentId, "memory-plugin.json");
}
/**
 * Load and validate config for an agent.
 * Falls back to defaults for optional fields.
 */
export function loadConfig(agentId, baseDir) {
    const configPath = resolveConfigPath(agentId, baseDir);
    let raw = {};
    if (existsSync(configPath)) {
        try {
            raw = JSON.parse(readFileSync(configPath, "utf-8"));
        }
        catch (err) {
            console.warn(`[config] Failed to parse config at ${configPath}: ${err}. Using defaults.`);
        }
    }
    else {
        console.log(`[config] No config file at ${configPath}, using defaults.`);
    }
    return {
        agentId,
        ...CONFIG_DEFAULTS,
        ...raw,
    };
}
/**
 * Validate config against the schema.
 * Throws if invalid.
 */
export function validateConfig(config) {
    // Basic required field check
    if (!config.agentId || typeof config.agentId !== "string" || config.agentId.trim() === "") {
        throw new Error("Config validation failed: agentId is required and must be a non-empty string");
    }
    // Validate types
    if (config.dataDir !== undefined && typeof config.dataDir !== "string") {
        throw new Error("Config validation failed: dataDir must be a string");
    }
    if (config.lmStudioUrl !== undefined && typeof config.lmStudioUrl !== "string") {
        throw new Error("Config validation failed: lmStudioUrl must be a string");
    }
    if (config.embeddingModel !== undefined && typeof config.embeddingModel !== "string") {
        throw new Error("Config validation failed: embeddingModel must be a string");
    }
    if (config.embeddingDimension !== undefined && (typeof config.embeddingDimension !== "number" || config.embeddingDimension < 1)) {
        throw new Error("Config validation failed: embeddingDimension must be a positive number");
    }
    if (config.batchSize !== undefined && (typeof config.batchSize !== "number" || config.batchSize < 1 || config.batchSize > 256)) {
        throw new Error("Config validation failed: batchSize must be between 1 and 256");
    }
    if (config.backupIntervalMs !== undefined && (typeof config.backupIntervalMs !== "number" || config.backupIntervalMs < 60_000)) {
        throw new Error("Config validation failed: backupIntervalMs must be >= 60000");
    }
    if (config.maxBackups !== undefined && (typeof config.maxBackups !== "number" || config.maxBackups < 1)) {
        throw new Error("Config validation failed: maxBackups must be >= 1");
    }
    if (config.indexUpdateIntervalMs !== undefined && (typeof config.indexUpdateIntervalMs !== "number" || config.indexUpdateIntervalMs < 5_000)) {
        throw new Error("Config validation failed: indexUpdateIntervalMs must be >= 5000");
    }
}
/**
 * Get the resolved data directory for an agent.
 */
export function resolveDataDir(config) {
    if (config.dataDir)
        return resolve(config.dataDir);
    return resolve(cwd(), "data", "agents", config.agentId, "memory");
}
//# sourceMappingURL=config.js.map