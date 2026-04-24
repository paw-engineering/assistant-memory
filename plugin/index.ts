import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type {
  MemoryEntry,
  AgentMemoryConfig,
  Logger,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { loadConfig, resolveDataDir, resolveBackupDir } from "./config.js";
import { createLmStudioClient } from "./lmstudio.js";
import { createStore } from "./store.js";
import { createBackupService, backupNow } from "./backup.js";

// =============================================================================
// Category Detection
// =============================================================================

const CATEGORY_PATTERNS: Record<MemoryEntry["category"], RegExp[]> = {
  preference: [/prefer|i like|i hate|i want|i need|always|never/i, /můj\s+\w+\s+je|je\s+můj/i, /my\s+\w+\s+is|is\s+my/i],
  fact: [/[\w.-]+@[\w.-]+\.\w+/, /\+\d{10,}/, /\d{4,}/],
  decision: [/rozhodli jsme|budeme používat|zapamatuj si/i, /we decided|we will use|remember/i],
  learning: [/zjistil jsem|learned|naučil jsem/i, /i learned|i discovered|i found/i],
  other: [],
};

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /disregard (all|any|previous|above|prior) instructions/i,
  /forget (all|any|previous|above|prior) instructions/i,
  /^ignore\s/i,
  /^disregard\s/i,
];

const MAX_CAPTURE_CHARS_DEFAULT = 2000;

function detectCategory(text: string): MemoryEntry["category"] {
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS) as [
    MemoryEntry["category"],
    RegExp[],
  ][]) {
    if (patterns.some((p) => p.test(text))) return category;
  }
  return "other";
}

function shouldCapture(text: string, maxChars: number): boolean {
  if (text.length < 10 || text.length > maxChars) return false;
  if (PROMPT_INJECTION_PATTERNS.some((p) => p.test(text))) return false;
  return true;
}

// =============================================================================
// Memory Context Formatter
// =============================================================================

function formatRelevantMemoriesContext(memories: Array<{ category: string; text: string }>): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `[${m.category.toUpperCase()}] ${m.text}`);
  return `\n\n---\nMEMORIES:\n${lines.join("\n")}\n---\n`;
}

// =============================================================================
// Plugin Entry Point
// =============================================================================

export function createPlugin(configPath: string) {
  return async function memoryPlugin(api: OpenClawPluginApi): Promise<void> {
    const logger: Logger = {
      info: (msg) => api.logger.info(msg),
      warn: (msg) => api.logger.warn(msg),
      error: (msg) => api.logger.error(msg),
      debug: (msg) => api.logger.debug?.(msg),
    };

    // -------------------------------------------------------------------------
    // Load per-agent config
    // -------------------------------------------------------------------------
    let config: AgentMemoryConfig;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      logger.error(`memory plugin: failed to load config: ${String(err)}`);
      return;
    }

    const baseDir = api.resolvePath(".");
    const dataDir = resolveDataDir(baseDir, config);
    const backupDir = resolveBackupDir(baseDir, config);

    // -------------------------------------------------------------------------
    // Initialize core services
    // -------------------------------------------------------------------------
    const embeddings = createLmStudioClient({
      url: config.lmStudioUrl,
      model: config.lmStudioModel,
      logger,
    });

    const store = await createStore(embeddings, { dataDir, logger });

    // -------------------------------------------------------------------------
    // Periodic backup service
    // -------------------------------------------------------------------------
    const backupService = createBackupService(store, {
      backupDir,
      intervalMinutes: config.backupInterval,
      logger,
    });

    // -------------------------------------------------------------------------
    // Tools
    // -------------------------------------------------------------------------

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "Search agent memories by semantic similarity",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "integer", description: "Max results", default: 5 },
            minScore: { type: "number", description: "Min relevance score", default: 0.3 },
          },
          required: ["query"],
        },
        async execute(_toolCallId, params) {
          const { query, limit = 5, minScore = 0.3 } = params as {
            query?: string;
            limit?: number;
            minScore?: number;
          };

          if (!query) {
            return {
              content: [{ type: "text", text: "Provide a query." }],
              details: { error: "missing_query" },
            };
          }

          try {
            const vector = await embeddings.embed(query);
            const results = await store.search(vector, limit, minScore);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { found: 0 },
              };
            }

            const output = results.map((r) => ({
              id: r.entry.id,
              text: r.entry.text,
              category: r.entry.category,
              importance: r.entry.importance,
              score: r.score,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} memories:\n${JSON.stringify(output, null, 2)}`,
                },
              ],
              details: { found: results.length, results: output },
            };
          } catch (err) {
            logger.error(`memory_search failed: ${String(err)}`);
            return {
              content: [{ type: "text", text: `Search failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description: "Store a new memory for the agent",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Memory content" },
            importance: { type: "number", description: "Importance 0-1", default: 0.7 },
            category: {
              type: "string",
              enum: ["preference", "fact", "decision", "learning", "other"],
              description: "Memory category",
              default: "other",
            },
            tags: { type: "array", items: { type: "string" }, description: "Tags" },
          },
          required: ["text"],
        },
        async execute(_toolCallId, params) {
          const {
            text,
            importance = 0.7,
            category = "other",
            tags,
          } = params as {
            text?: string;
            importance?: number;
            category?: MemoryEntry["category"];
            tags?: string[];
          };

          if (!text) {
            return {
              content: [{ type: "text", text: "Provide text." }],
              details: { error: "missing_text" },
            };
          }

          // Check for duplicates
          try {
            const vector = await embeddings.embed(text);
            const existing = await store.search(vector, 1, 0.95);
            if (existing.length > 0) {
              return {
                content: [{ type: "text", text: `Similar memory exists: "${existing[0].entry.text}"` }],
                details: {
                  action: "duplicate",
                  existingId: existing[0].entry.id,
                },
              };
            }

            const entry = await store.store({
              text,
              vector,
              importance,
              category,
              tags,
            });

            return {
              content: [{ type: "text", text: `Stored: "${text.slice(0, 100)}..."` }],
              details: { action: "created", id: entry.id },
            };
          } catch (err) {
            logger.error(`memory_store failed: ${String(err)}`);
            return {
              content: [{ type: "text", text: `Store failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search to find memory" },
            memoryId: { type: "string", description: "Specific memory ID" },
          },
        },
        async execute(_toolCallId, params) {
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          if (memoryId) {
            try {
              await store.delete(memoryId);
              return {
                content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
                details: { action: "deleted", id: memoryId },
              };
            } catch (err) {
              return {
                content: [{ type: "text", text: `Delete failed: ${String(err)}` }],
                details: { error: String(err) },
              };
            }
          }

          if (query) {
            try {
              const vector = await embeddings.embed(query);
              const results = await store.search(vector, 5, 0.7);

              if (results.length === 0) {
                return {
                  content: [{ type: "text", text: "No matching memories found." }],
                  details: { found: 0 },
                };
              }

              if (results.length === 1 && results[0].score > 0.9) {
                await store.delete(results[0].entry.id);
                return {
                  content: [{ type: "text", text: `Forgotten: "${results[0].entry.text}"` }],
                  details: { action: "deleted", id: results[0].entry.id },
                };
              }

              const list = results
                .map((r) => `- [${r.entry.id.slice(0, 8)}] ${r.entry.text.slice(0, 60)}...`)
                .join("\n");

              return {
                content: [
                  {
                    type: "text",
                    text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                  },
                ],
                details: {
                  action: "candidates",
                  candidates: results.map((r) => ({
                    id: r.entry.id,
                    text: r.entry.text,
                    category: r.entry.category,
                    score: r.score,
                  })),
                },
              };
            } catch (err) {
              return {
                content: [{ type: "text", text: `Search failed: ${String(err)}` }],
                details: { error: String(err) },
              };
            }
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      },
      { name: "memory_forget" },
    );

    api.registerTool(
      {
        name: "memory_backup",
        label: "Memory Backup",
        description: "Trigger an immediate backup of memory data",
        parameters: {
          type: "object",
          properties: {},
        },
        async execute(_toolCallId) {
          try {
            await backupNow(store, backupDir, "agent", logger);
            return {
              content: [{ type: "text", text: "Backup completed." }],
              details: { action: "backup_complete" },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Backup failed: ${String(err)}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_backup" },
    );

    // -------------------------------------------------------------------------
    // CLI Commands
    // -------------------------------------------------------------------------

    api.registerCli(
      ({ program }) => {
        const memory = program
          .command("memory")
          .description("Agent memory plugin commands");

        memory
          .command("list")
          .description("List memory count")
          .action(async () => {
            try {
              const count = await store.count();
              console.log(`Total memories: ${count}`);
            } catch (err) {
              console.error(`Failed: ${String(err)}`);
            }
          });

        memory
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .action(async (query, opts) => {
            try {
              const vector = await embeddings.embed(query);
              const results = await store.search(
                vector,
                parseInt(opts.limit),
                0.3,
              );
              const output = results.map((r) => ({
                id: r.entry.id,
                text: r.entry.text,
                category: r.entry.category,
                score: r.score,
              }));
              console.log(JSON.stringify(output, null, 2));
            } catch (err) {
              console.error(`Search failed: ${String(err)}`);
            }
          });

        memory
          .command("backup")
          .description("Trigger immediate backup")
          .action(async () => {
            try {
              await backupNow(store, backupDir, "agent", logger);
              console.log("Backup completed.");
            } catch (err) {
              console.error(`Backup failed: ${String(err)}`);
            }
          });
      },
      { commands: ["memory"] },
    );

    // -------------------------------------------------------------------------
    // Lifecycle Hooks
    // -------------------------------------------------------------------------

    if (config.autoRecall) {
      api.on("before_agent_start", async (event) => {
        const ctx = event as { prompt?: string };
        if (!ctx.prompt || ctx.prompt.length < 5) return;

        try {
          const vector = await embeddings.embed(ctx.prompt);
          const results = await store.search(vector, 3, 0.3);
          if (results.length === 0) return;

          logger.info(`memory: injecting ${results.length} memories`);
          return {
            prependContext: formatRelevantMemoriesContext(
              results.map((r) => ({ category: r.entry.category, text: r.entry.text })),
            ),
          };
        } catch (err) {
          logger.warn(`memory: recall failed: ${String(err)}`);
        }
      });
    }

    if (config.autoCapture) {
      api.on("agent_end", async (event) => {
        const ctx = event as { success?: boolean; messages?: unknown[] };
        if (!ctx.success || !ctx.messages || ctx.messages.length === 0) return;

        const texts: string[] = [];
        for (const msg of ctx.messages) {
          if (!msg || typeof msg !== "object") continue;
          const m = msg as Record<string, unknown>;
          if (m.role !== "user") continue;

          const content = m.content;
          if (typeof content === "string") {
            texts.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block &&
                typeof block === "object" &&
                "type" in block &&
                (block as Record<string, unknown>).type === "text" &&
                "text" in block &&
                typeof (block as Record<string, unknown>).text === "string"
              ) {
                texts.push((block as Record<string, unknown>).text as string);
              }
            }
          }
        }

        const maxChars = config.captureMaxChars ?? MAX_CAPTURE_CHARS_DEFAULT;
        const toCapture = texts.filter((t) => shouldCapture(t, maxChars));
        if (toCapture.length === 0) return;

        let stored = 0;
        for (const text of toCapture.slice(0, 3)) {
          try {
            const vector = await embeddings.embed(text);
            const existing = await store.search(vector, 1, 0.95);
            if (existing.length > 0) continue;

            const category = detectCategory(text);
            await store.store({ text, vector, importance: 0.7, category });
            stored++;
          } catch {
            // Best-effort
          }
        }

        if (stored > 0) {
          logger.info(`memory: auto-captured ${stored} memories`);
        }
      });
    }

    // -------------------------------------------------------------------------
    // Service (start/stop lifecycle)
    // -------------------------------------------------------------------------

    api.registerService({
      id: "assistant-memory",
      start() {
        logger.info(
          `assistant-memory: initialized (model: ${embeddings.model()}, backup: every ${config.backupInterval}min)`,
        );
        backupService.start();
      },
      stop() {
        backupService.stop();
        logger.info("assistant-memory: stopped");
      },
    });
  };
}
