import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
export function tempfile() {
    const dir = join(tmpdir(), `assistant-memory-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}
export function cleanupTempDir(dir) {
    try {
        rmSync(dir, { recursive: true, force: true });
    }
    catch {
        // Ignore cleanup errors
    }
}
//# sourceMappingURL=helpers.js.map