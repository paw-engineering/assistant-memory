import { describe, it, expect } from "vitest";
import {
  CONFIG_DEFAULTS,
  resolveConfigPath,
  resolveDataDir,
  validateConfig,
  type MemoryPluginConfig,
} from "../src/config.js";

describe("CONFIG_DEFAULTS", () => {
  it("has correct backup interval (5 minutes)", () => {
    expect(CONFIG_DEFAULTS.backupIntervalMs).toBe(300_000);
  });

  it("has correct embedding model", () => {
    expect(CONFIG_DEFAULTS.embeddingModel).toBe("text-embedding-qwen3-embedding-4b");
  });

  it("has correct lmStudioUrl", () => {
    expect(CONFIG_DEFAULTS.lmStudioUrl).toBe("http://192.168.64.1:1234/v1");
  });
});

describe("resolveConfigPath", () => {
  it("resolves to config/agents/{agentId}/memory-plugin.json", () => {
    const path = resolveConfigPath("test-agent");
    expect(path).toContain("config");
    expect(path).toContain("agents");
    expect(path).toContain("test-agent");
    expect(path).toContain("memory-plugin.json");
  });

  it("uses custom baseDir when provided", () => {
    const path = resolveConfigPath("test-agent", "/custom/base");
    expect(path).toBe("/custom/base/config/agents/test-agent/memory-plugin.json");
  });
});

describe("resolveDataDir", () => {
  it("uses explicit dataDir when set", () => {
    const config: MemoryPluginConfig = { agentId: "test", dataDir: "/explicit/path" };
    expect(resolveDataDir(config)).toBe("/explicit/path");
  });

  it("defaults to data/agents/{agentId}/memory", () => {
    const config: MemoryPluginConfig = { agentId: "my-agent" };
    const resolved = resolveDataDir(config);
    expect(resolved).toContain("data");
    expect(resolved).toContain("agents");
    expect(resolved).toContain("my-agent");
    expect(resolved).toContain("memory");
  });
});

describe("validateConfig", () => {
  it("passes for valid config", () => {
    const config: MemoryPluginConfig = { agentId: "test-agent" };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("throws for missing agentId", () => {
    expect(() => validateConfig({} as MemoryPluginConfig)).toThrow(/agentId.*required/);
  });

  it("throws for empty agentId", () => {
    expect(() => validateConfig({ agentId: "" } as MemoryPluginConfig)).toThrow(/agentId.*required/);
  });

  it("throws for whitespace-only agentId", () => {
    expect(() => validateConfig({ agentId: "   " } as MemoryPluginConfig)).toThrow(/agentId.*required/);
  });

  it("throws for backupIntervalMs below 60 seconds", () => {
    const config: MemoryPluginConfig = { agentId: "test", backupIntervalMs: 30_000 };
    expect(() => validateConfig(config)).toThrow(/backupIntervalMs.*60000/);
  });

  it("throws for indexUpdateIntervalMs below 5 seconds", () => {
    const config: MemoryPluginConfig = { agentId: "test", indexUpdateIntervalMs: 1_000 };
    expect(() => validateConfig(config)).toThrow(/indexUpdateIntervalMs.*5000/);
  });

  it("throws for invalid maxBackups", () => {
    const config: MemoryPluginConfig = { agentId: "test", maxBackups: 0 };
    expect(() => validateConfig(config)).toThrow(/maxBackups.*>= 1/);
  });
});