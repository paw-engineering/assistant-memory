import { describe, it, expect } from "vitest";
import { readVersion, logVersion, isWellFormedVersion, type PluginVersion } from "../src/versioning.js";

describe("readVersion", () => {
  it("returns a PluginVersion object with version string", () => {
    const result = readVersion();
    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("source");
    expect(typeof result.version).toBe("string");
  });

  it("returns source as file when VERSION file exists", () => {
    const result = readVersion();
    if (result.version !== "unknown") {
      expect(result.source).toBe("file");
    }
  });
});

describe("isWellFormedVersion", () => {
  it("returns true for simple version strings like v1, v12", () => {
    expect(isWellFormedVersion("v1")).toBe(true);
    expect(isWellFormedVersion("v12")).toBe(true);
    expect(isWellFormedVersion("v123")).toBe(true);
  });

  it("returns false for semver-style versions", () => {
    expect(isWellFormedVersion("1.0.0")).toBe(false);
    expect(isWellFormedVersion("v1.0.0")).toBe(false);
  });

  it("returns false for non-version strings", () => {
    expect(isWellFormedVersion("invalid")).toBe(false);
    expect(isWellFormedVersion("")).toBe(false);
    expect(isWellFormedVersion("v")).toBe(false);
  });
});

describe("logVersion", () => {
  it("does not throw", () => {
    expect(() => logVersion()).not.toThrow();
  });
});

describe("PluginVersion type", () => {
  it("has correct shape", () => {
    const version: PluginVersion = {
      version: "1.0.0",
      source: "file",
    };
    expect(version.version).toBe("1.0.0");
    expect(version.source).toBe("file");
  });
});
