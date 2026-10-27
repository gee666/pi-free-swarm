import { createHash } from "node:crypto";
import { SEARCH_EMBEDDING_BATCH } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { cosineSimilarity, type SearchDocument } from "./ranking.js";
import { postJson } from "./remote.js";
import { isRecord, type SearchEndpoint } from "./settings.js";

export type SearchKind = "post" | "task" | "criterion" | "skill";

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function documentText(document: SearchDocument): string {
  return `${document.title}\n${document.text}`;
}

export async function embeddingRanking<T extends SearchDocument>(options: {
  db: SwarmDb;
  kind: SearchKind;
  query: string;
  documents: readonly T[];
  endpoint: SearchEndpoint;
  signal: AbortSignal;
  fetcher: typeof fetch;
}): Promise<T[]> {
  const { db, kind, documents, endpoint, signal, fetcher } = options;
  const vectors = new Map<string, number[]>();
  const missing: { document: T; hash: string; text: string }[] = [];
  for (const document of documents) {
    const text = documentText(document);
    const hash = contentHash(text);
    const row = db.sql
      .prepare("SELECT vector, content_hash FROM search_embeddings WHERE kind = ? AND ref_id = ? AND model = ?")
      .get(kind, document.id, endpoint.model);
    if (row?.content_hash === hash && row.vector instanceof Uint8Array) {
      const values: unknown = JSON.parse(Buffer.from(row.vector).toString("utf8"));
      vectors.set(document.id, validVector(values));
    } else missing.push({ document, hash, text });
  }
  const [queryVector] = await embed([options.query]);
  if (queryVector === undefined) throw new Error("missing query embedding");
  for (let offset = 0; offset < missing.length; offset += SEARCH_EMBEDDING_BATCH) {
    const batch = missing.slice(offset, offset + SEARCH_EMBEDDING_BATCH);
    const computed = await embed(batch.map((entry) => entry.text));
    signal.throwIfAborted();
    db.write(() => {
      batch.forEach((entry, index) => {
        const vector = computed[index];
        cosineSimilarity(queryVector, vector);
        db.sql
          .prepare(
            `INSERT INTO search_embeddings (kind, ref_id, model, content_hash, vector)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, ref_id, model) DO UPDATE SET
          content_hash = excluded.content_hash, vector = excluded.vector`,
          )
          .run(kind, entry.document.id, endpoint.model, entry.hash, Buffer.from(JSON.stringify(vector)));
        vectors.set(entry.document.id, vector);
      });
    });
  }
  return documents
    .map((document, index) => {
      const vector = vectors.get(document.id);
      if (vector === undefined) throw new Error("missing document embedding");
      return { document, index, score: cosineSimilarity(queryVector, vector) };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.document);

  async function embed(input: string[]): Promise<number[][]> {
    const reply = await postJson(
      endpoint,
      `${endpoint.url.replace(/\/+$/, "")}/embeddings`,
      { model: endpoint.model, input },
      signal,
      fetcher,
    );
    if (!isRecord(reply) || !Array.isArray(reply.data) || reply.data.length !== input.length) {
      throw new Error("invalid embeddings reply");
    }
    const indexed = new Map<number, number[]>();
    for (const entry of reply.data) {
      if (
        !isRecord(entry) ||
        typeof entry.index !== "number" ||
        !Number.isInteger(entry.index) ||
        entry.index < 0 ||
        entry.index >= input.length ||
        indexed.has(entry.index)
      ) {
        throw new Error("invalid embedding index");
      }
      indexed.set(entry.index, validVector(entry.embedding));
    }
    return input.map((_, index) => {
      const vector = indexed.get(index);
      if (vector === undefined) throw new Error("missing embedding index");
      return vector;
    });
  }
}

function validVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid embedding vector");
  const vector: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new Error("invalid embedding vector");
    vector.push(entry);
  }
  cosineSimilarity(vector, vector);
  return vector;
}
