import type { MemoryService } from "./index.js";

export interface ServerConfig {
  port?: number;
  host?: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  embedderOk: boolean;
  dbOk: boolean;
  entries: number;
  lastCheck: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

export function startHttpServer(service: MemoryService, config: ServerConfig = {}): () => void {
  const port = config.port ?? 7420;
  const host = config.host ?? "0.0.0.0";

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\//, "");

      try {
        // GET /health
        if (req.method === "GET" && path === "health") {
          const embedderOk = await service.search("healthcheck", 1, 0.99)
            .then(() => true)
            .catch(() => false);
          const entries = await service.count();
          const status: HealthStatus = {
            status: embedderOk ? "ok" : "degraded",
            embedderOk,
            dbOk: entries >= 0,
            entries,
            lastCheck: Date.now(),
          };
          return json(status);
        }

        // GET /status
        if (req.method === "GET" && path === "status") {
          const entries = await service.list();
          return json({
            entries: entries.length,
            version: service.version(),
            lastSync:
              entries.length > 0
                ? Math.max(...entries.map((e) => e.createdAt))
                : null,
          });
        }

        // GET /version
        if (req.method === "GET" && path === "version") {
          return json({ version: service.version() });
        }

        // POST /search
        if (req.method === "POST" && path === "search") {
          const body = await parseBody<{ query: string; limit?: number; minScore?: number }>(req);
          const results = await service.search(body.query, body.limit ?? 5, body.minScore ?? 0.3);
          return json({ results, meta: { total: results.length } });
        }

        // POST /add
        if (req.method === "POST" && path === "add") {
          const body = await parseBody<{
            text: string;
            importance?: number;
            category?: "preference" | "fact" | "decision" | "learning" | "other";
            tags?: string[];
          }>(req);
          const entry = await service.add(body.text, body.importance, body.category, body.tags);
          return json({ entry }, 201);
        }

        // POST /delete
        if (req.method === "POST" && path === "delete") {
          const body = await parseBody<{ id?: string; query?: string; byId?: boolean }>(req);
          if (!body.id && !body.query) {
            return json({ error: "id or query required" }, 400);
          }
          const result =
            body.byId || body.id
              ? await service.delete(body.id!, true)
              : await service.delete(body.query!, false);
          return json(result);
        }

        // POST /update/:id
        if (req.method === "POST" && path.startsWith("update/")) {
          const id = path.split("/")[1];
          const body = await parseBody<{ text?: string; importance?: number }>(req);
          if (!body.text && body.importance === undefined) {
            return json({ error: "text or importance required" }, 400);
          }
          const entry = await service.update(id, body.text ?? "", body.importance);
          return json({ entry });
        }

        // POST /backup
        if (req.method === "POST" && path === "backup") {
          await service.backup();
          return json({ ok: true });
        }

        return json({ error: "not found" }, 404);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    },
  });

  console.log(`assistant-memory HTTP server listening on ${host}:${port}`);
  return () => server.stop();
}