/**
 * Option B (base image update model) — Version metadata for the per-agent memory plugin.
 *
 * The plugin version is read from the VERSION file at startup and logged.
 * If the VERSION file is missing or malformed, startup continues but logs a warning.
 *
 * Version pinning (blocking startup on version mismatch) is NOT implemented.
 * The version is for display, logging, and debugging purposes only.
 *
 * Marcus owns the base image. Agents can read the version to confirm what
 * version of the plugin code they are running.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PluginVersion {
  version: string;
  source: "file" | "unknown";
}

/**
 * Read the plugin version from the VERSION file in the plugin directory.
 * Returns "unknown" if the file doesn't exist or is empty.
 *
 * This is for display/logging only — does not block startup.
 */
export function readVersion(pluginDir?: string): PluginVersion {
  const dir = pluginDir ?? dirname(fileURLToPath(import.meta.url));
  const versionFile = resolve(dir, "VERSION");

  if (!existsSync(versionFile)) {
    return { version: "unknown", source: "unknown" };
  }

  const content = readFileSync(versionFile, "utf-8").trim();
  if (!content) {
    return { version: "unknown", source: "unknown" };
  }

  return { version: content, source: "file" };
}

/**
 * Log the current plugin version. Safe to call at startup.
 * Does nothing if version is unknown.
 */
export function logVersion(pluginDir?: string): void {
  const { version, source } = readVersion(pluginDir);
  if (version !== "unknown") {
    console.log(`[assistant-memory] version ${version} (${source})`);
  } else {
    console.log(`[assistant-memory] version: unknown (no VERSION file)`);
  }
}

/**
 * Validate that a version string is well-formed (e.g. "v1", "v12").
 */
export function isWellFormedVersion(v: string): boolean {
  return /^v\d+$/.test(v.trim());
}
