/**
 * Option A (pinned) versioning for the per-agent memory plugin.
 *
 * Each release of the plugin publishes a VERSION file in the plugin directory.
 * Agents lock to the pinned version — startup halts if there's a mismatch.
 *
 * Marcus controls the update cadence: nothing ships to agents without an explicit
 * version bump in the plugin repo and agent-side config update.
 *
 * Migration: skip, start fresh. Nothing worth migrating from the broken lobs-memory.
 */
/** Current plugin version — bump when releasing a new version. */
export declare const CURRENT_VERSION = "v1";
export interface VersionCheckResult {
    ok: boolean;
    current: string;
    pinned: string;
    message: string;
}
/**
 * Read the pinned version from the VERSION file in the plugin directory.
 * Falls back to the version from this file if pluginDir is not provided.
 */
export declare function readPinnedVersion(pluginDir?: string): string;
/**
 * Check that the plugin version matches CURRENT_VERSION.
 *
 * Halts with a descriptive error if:
 * - VERSION file is missing
 * - VERSION file is empty
 * - VERSION does not match CURRENT_VERSION
 *
 * Call this early during plugin bootstrap, before any other init.
 */
export declare function checkVersion(pluginDir?: string): VersionCheckResult;
/**
 * Enforce version check — throws if the version is mismatched.
 * Use this in plugin init to halt early with a clear error.
 *
 * @throws {Error} if version check fails
 */
export declare function enforceVersion(pluginDir?: string): void;
/**
 * Validate that a version string is well-formed (e.g. "v1", "v12").
 */
export declare function isWellFormedVersion(v: string): boolean;
//# sourceMappingURL=versioning.d.ts.map