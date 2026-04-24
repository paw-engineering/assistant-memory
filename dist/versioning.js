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
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
/** Current plugin version — bump when releasing a new version. */
export const CURRENT_VERSION = "v1";
/**
 * Read the pinned version from the VERSION file in the plugin directory.
 * Falls back to the version from this file if pluginDir is not provided.
 */
export function readPinnedVersion(pluginDir) {
    const dir = pluginDir ?? dirname(fileURLToPath(import.meta.url));
    const versionFile = resolve(dir, "VERSION");
    if (!existsSync(versionFile)) {
        throw new Error(`VERSION file not found at ${versionFile}. ` +
            `Plugin must include a VERSION file pinned to "${CURRENT_VERSION}".`);
    }
    const content = readFileSync(versionFile, "utf-8").trim();
    if (!content) {
        throw new Error(`VERSION file at ${versionFile} is empty. ` +
            `Expected content: "${CURRENT_VERSION}".`);
    }
    return content;
}
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
export function checkVersion(pluginDir) {
    let pinned;
    try {
        pinned = readPinnedVersion(pluginDir);
    }
    catch (err) {
        return {
            ok: false,
            current: CURRENT_VERSION,
            pinned: "<missing>",
            message: err instanceof Error ? err.message : String(err),
        };
    }
    if (pinned !== CURRENT_VERSION) {
        return {
            ok: false,
            current: CURRENT_VERSION,
            pinned,
            message: `Plugin version mismatch: agent is "${CURRENT_VERSION}" but plugin is "${pinned}". ` +
                `Halting until Marcus bumps the agent-side version to "${pinned}". ` +
                `Migration: skip, start fresh after update.`,
        };
    }
    return {
        ok: true,
        current: CURRENT_VERSION,
        pinned,
        message: `Version check passed: plugin is "${pinned}".`,
    };
}
/**
 * Enforce version check — throws if the version is mismatched.
 * Use this in plugin init to halt early with a clear error.
 *
 * @throws {Error} if version check fails
 */
export function enforceVersion(pluginDir) {
    const result = checkVersion(pluginDir);
    if (!result.ok) {
        throw new Error(result.message);
    }
}
/**
 * Validate that a version string is well-formed (e.g. "v1", "v12").
 */
export function isWellFormedVersion(v) {
    return /^v\d+$/.test(v.trim());
}
//# sourceMappingURL=versioning.js.map