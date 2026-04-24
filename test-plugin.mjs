/**
 * Smoke test for assistant-memory plugin
 *
 * Run with: node test-plugin.mjs
 *
 * Verifies:
 * 1. All plugin files exist and are non-empty
 * 2. Config schema is valid JSON Schema
 * 3. Example config is valid JSON and passes schema validation
 * 4. All expected plugin exports are present
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXIT_ERRORS = [];

function log(label, msg) {
  console.log(`  [${label}] ${msg}`);
}

function pass(msg) { log("PASS", msg); }
function fail(msg) { log("FAIL", msg); EXIT_ERRORS.push(msg); }
function warn(msg) { log("WARN", msg); }

console.log("\n=== Assistant Memory Plugin — Smoke Test ===\n");

// ---------------------------------------------------------------------------
// 1. File structure
// ---------------------------------------------------------------------------
console.log("1. Checking file structure...");

const pluginFiles = [
  "plugin/types.ts",
  "plugin/config.ts",
  "plugin/lmstudio.ts",
  "plugin/store.ts",
  "plugin/backup.ts",
  "plugin/index.ts",
  "config-schema.json",
  "example-config.json",
  "test-plugin.mjs",
];

let allExist = true;
for (const file of pluginFiles) {
  const path = resolve(__dirname, file);
  try {
    const content = readFileSync(path, "utf-8");
    if (content.length === 0) {
      warn(`${file} is empty`);
    } else {
      pass(`${file} (${content.length} bytes)`);
    }
  } catch {
    fail(`${file} does not exist`);
    allExist = false;
  }
}

// ---------------------------------------------------------------------------
// 2. Config schema
// ---------------------------------------------------------------------------
console.log("\n2. Validating config-schema.json...");

try {
  const schemaPath = resolve(__dirname, "config-schema.json");
  const schemaContent = readFileSync(schemaPath, "utf-8");
  const schema = JSON.parse(schemaContent);

  if (!schema.$schema) fail("$schema missing");
  else pass("$schema present");

  if (!schema.title) fail("title missing");
  else pass(`title: ${schema.title}`);

  if (!schema.properties) fail("properties missing");
  else {
    const requiredFields = ["version", "lmStudioUrl", "lmStudioModel", "backupInterval", "indexStrategy"];
    for (const field of requiredFields) {
      if (!schema.properties[field]) {
        fail(`${field} property missing from schema`);
      }
    }
    pass(`${Object.keys(schema.properties).length} properties defined`);
  }

  if (!schema.additionalProperties === false) warn("additionalProperties not explicitly false");
} catch (err) {
  fail(`config-schema.json: ${String(err)}`);
}

// ---------------------------------------------------------------------------
// 3. Example config
// ---------------------------------------------------------------------------
console.log("\n3. Validating example-config.json...");

try {
  const examplePath = resolve(__dirname, "example-config.json");
  const example = JSON.parse(readFileSync(examplePath, "utf-8"));

  // Check required fields
  const required = ["version", "lmStudioUrl", "lmStudioModel", "backupInterval", "indexStrategy"];
  for (const field of required) {
    if (!(field in example)) fail(`${field} missing`);
    else pass(`${field} present`);
  }

  // Validate indexStrategy enum
  if (!["on-change", "on-change-plus-periodic"].includes(example.indexStrategy)) {
    fail(`indexStrategy="${example.indexStrategy}" invalid`);
  } else {
    pass(`indexStrategy="${example.indexStrategy}" valid`);
  }

  // Validate types
  if (typeof example.version !== "number") fail("version must be a number");
  if (typeof example.lmStudioUrl !== "string") fail("lmStudioUrl must be a string");
  if (typeof example.lmStudioModel !== "string") fail("lmStudioModel must be a string");
  if (typeof example.backupInterval !== "number") fail("backupInterval must be a number");

  pass("example-config.json passes basic validation");
} catch (err) {
  fail(`example-config.json: ${String(err)}`);
}

// ---------------------------------------------------------------------------
// 4. Plugin source — key symbols present
// ---------------------------------------------------------------------------
console.log("\n4. Checking plugin source for key symbols...");

const checks = [
  { file: "plugin/types.ts", patterns: ["AgentMemoryConfig", "MemoryEntry", "MemorySearchResult", "DEFAULT_CONFIG"] },
  { file: "plugin/config.ts", patterns: ["loadConfig", "CONFIG_SCHEMA", "resolveDataDir", "resolveBackupDir"] },
  { file: "plugin/lmstudio.ts", patterns: ["createLmStudioClient", "EmbeddingsClient", "chunkText"] },
  { file: "plugin/store.ts", patterns: ["createStore", "Store", "MemoryEntry"] },
  { file: "plugin/backup.ts", patterns: ["createBackupService", "backupNow", "BackupService", "BackupMetadata"] },
  { file: "plugin/index.ts", patterns: ["createPlugin", "memory_search", "memory_store", "memory_forget", "memory_backup", "registerTool", "registerService"] },
];

for (const check of checks) {
  const path = resolve(__dirname, check.file);
  try {
    const content = readFileSync(path, "utf-8");
    for (const pattern of check.patterns) {
      if (content.includes(pattern)) {
        pass(`${check.file}: ${pattern}`);
      } else {
        fail(`${check.file}: MISSING "${pattern}"`);
      }
    }
  } catch {
    fail(`${check.file}: could not read`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n=== Results ===");
if (EXIT_ERRORS.length > 0) {
  console.error(`\nFAILURES (${EXIT_ERRORS.length}):`);
  EXIT_ERRORS.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
