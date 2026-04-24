/**
 * Per-Agent Memory Plugin — Main Entry Point
 *
 * Re-exports the public API from plugin.ts.
 */

export { createPlugin, initPlugin } from "./plugin.js";
export type { MemoryPlugin, MemoryPluginEvents, MemorySearchResult } from "./plugin.js";
export type { MemoryPluginConfig } from "./config.js";
export { loadConfig, validateConfig, resolveDataDir, resolveConfigPath, CONFIG_SCHEMA } from "./config.js";
export { MemoryStorage } from "./storage.js";
export type { MemoryItem } from "./storage.js";
export { FaissIndex } from "./faiss.js";
export type { FaissSearchResult } from "./faiss.js";
export { Embedder } from "./embedder.js";
export type { EmbedderConfig } from "./embedder.js";
export { BackupManager } from "./backup.js";
