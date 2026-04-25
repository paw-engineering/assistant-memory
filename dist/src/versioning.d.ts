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
export declare function readVersion(pluginDir?: string): PluginVersion;
/**
 * Log the current plugin version. Safe to call at startup.
 * Does nothing if version is unknown.
 */
export declare function logVersion(pluginDir?: string): void;
/**
 * Validate that a version string is well-formed (e.g. "v1", "v12").
 */
export declare function isWellFormedVersion(v: string): boolean;
//# sourceMappingURL=versioning.d.ts.map