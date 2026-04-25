/**
 * Knowledge graph — entity relationships extracted from text chunks.
 */

import { insertEntity, insertRelationship } from "./db.js";

interface Entity {
  id?: number;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
  sourceChunkId?: number;
}

// Relation patterns — simple regex-based extraction
const RELATION_PATTERNS: Array<{
  regex: RegExp;
  extract: (m: RegExpMatchArray) => [string, string, string];
}> = [
  // "X uses/owns/manages/deploys Y"
  { regex: /(\w+)\s+(uses|manages|deploys|creates|builds|owns|writes|maintains)\s+(\w[\w\s-]*)/gi, extract: (m) => [m[1], m[2], m[3]] },
  // "X is a Y"
  { regex: /(\w[\w\s]+)\s+is\s+(?:an?\s+|the\s+)?([\w\s]+(?:system|service|tool|app|plugin|framework|library))/gi, extract: (m) => [m[1], "is_a", m[2]] },
  // "X depends on Y"
  { regex: /(\w[\w\s]*)\s+depends\s+on\s+(\w[\w\s]*)/gi, extract: (m) => [m[1], "depends_on", m[2]] },
];

function classifyEntity(name: string): string {
  const lower = name.toLowerCase();
  if (/^(https?:\/\/|www\.)/.test(name)) return "url";
  if (/^\d+\.\d+/.test(name)) return "version";
  if (/@/.test(name)) return "email";
  if (/^[A-Z][a-z]+[A-Z]/.test(name)) return "pascal_name";
  if (/^[a-z-]+\.(ts|js|py|go|rs|java)$/.test(lower)) return "file";
  if (/\/|\.git$/.test(name)) return "path";
  if (/^\d+$/.test(name)) return "number_literal";
  return "concept";
}

export function extractEntities(text: string, chunkId?: number): void {
  const seen = new Set<string>();

  for (const { regex, extract } of RELATION_PATTERNS) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      try {
        const [entity1, relation, entity2] = extract(match);
        
        // Entity 1
        const key1 = `${entity1}:${classifyEntity(entity1)}`;
        if (!seen.has(key1)) {
          insertEntity({ name: entity1.trim(), type: classifyEntity(entity1), sourceChunkId: chunkId });
          seen.add(key1);
        }

        // Entity 2
        const key2 = `${entity2}:${classifyEntity(entity2)}`;
        if (!seen.has(key2)) {
          insertEntity({ name: entity2.trim(), type: classifyEntity(entity2), sourceChunkId: chunkId });
          seen.add(key2);
        }

        // Relationship
        insertRelationship({
          entity1: entity1.trim(),
          entity1Type: classifyEntity(entity1),
          relation,
          entity2: entity2.trim(),
          entity2Type: classifyEntity(entity2),
          confidence: 0.7,
        });
      } catch { /* skip malformed match */ }
    }
  }
}
