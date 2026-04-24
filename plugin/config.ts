import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentMemoryConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// =============================================================================
// JSON Schema for per-agent config
// =============================================================================

export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "AgentMemoryConfig",
  type: "object",
  properties: {
    version: {
      type: "integer",
      description: "Config schema version",
      minimum: 1,
      default: 1,
    },
    lmStudioUrl: {
      type: "string",
      description: "LM Studio embeddings endpoint URL",
      format: "uri",
      default: "http://192.168.64.1:1234/v1/embeddings",
    },
    lmStudioModel: {
      type: "string",
      description: "Embedding model identifier in LM Studio",
      default: "text-embedding-qwen3-embedding-4b",
    },
    backupInterval: {
      type: "integer",
      description: "Backup interval in minutes",
      minimum: 1,
      maximum: 60,
      default: 5,
    },
    indexStrategy: {
      type: "string",
      enum: ["on-change", "on-change-plus-periodic"],
      default: "on-change-plus-periodic",
    },
    periodicInterval: {
      type: "integer",
      description: "Periodic sync interval in minutes (when on-change-plus-periodic)",
      minimum: 5,
      maximum: 1440,
      default: 30,
    },
    autoRecall: {
      type: "boolean",
      description: "Inject relevant memories before agent starts",
      default: false,
    },
    autoCapture: {
      type: "boolean",
      description: "Auto-capture important information after agent ends",
      default: false,
    },
    captureMaxChars: {
      type: "integer",
      description: "Max characters to capture per message",
      minimum: 100,
      maximum: 10000,
      default: 2000,
    },
    backupDir: {
      type: "string",
      description: "Directory for backups relative to agent data dir",
      default: ".memory/backups",
    },
    dataDir: {
      type: "string",
      description: "Base directory for memory data relative to agent data dir",
      default: ".memory",
    },
  },
  additionalProperties: false,
};

// =============================================================================
// Config Loader
// =============================================================================

const ajv = new Ajv({ allErrors: true, coerceTypes: false });

export function loadConfig(configPath: string): AgentMemoryConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`memory plugin: config file not found: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`memory plugin: config file is not valid JSON: ${configPath}`);
  }

  const validate = ajv.compile(CONFIG_SCHEMA);
  const valid = validate(parsed);

  if (!valid) {
    const errors = validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`memory plugin: config validation failed: ${errors}`);
  }

  // Merge with defaults
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