import { SEARCH_BM25_B, SEARCH_BM25_K1, SEARCH_RRF_K, SEARCH_TITLE_WEIGHT } from "../constants.js";

export interface SearchDocument {
  id: string;
  title: string;
  text: string;
}

const STOPWORDS = new Set(
  "a an and are as at be by for from in is it of on or that the this to was were with".split(" "),
);

export function tokenize(text: string): string[] {
  const words =
    text
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => !STOPWORDS.has(word));
}

export function bm25<T extends SearchDocument>(query: string, documents: readonly T[]): T[] {
  const terms = [...new Set(tokenize(query))];
  const corpus = documents.map((document) => {
    const title = tokenize(document.title);
    const body = tokenize(document.text);
    const counts = new Map<string, number>();
    for (const word of body) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of title) counts.set(word, (counts.get(word) ?? 0) + SEARCH_TITLE_WEIGHT);
    return { document, counts, length: title.length * SEARCH_TITLE_WEIGHT + body.length };
  });
  const average = corpus.reduce((sum, entry) => sum + entry.length, 0) / corpus.length || 1;
  const frequencies = new Map(terms.map((term) => [term, corpus.filter((entry) => entry.counts.has(term)).length]));
  return corpus
    .map((entry, index) => {
      let score = 0;
      for (const term of terms) {
        const frequency = entry.counts.get(term) ?? 0;
        const df = frequencies.get(term) ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        score +=
          (idf * frequency * (SEARCH_BM25_K1 + 1)) /
          (frequency + SEARCH_BM25_K1 * (1 - SEARCH_BM25_B + (SEARCH_BM25_B * entry.length) / average));
      }
      return { document: entry.document, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.document);
}

export function reciprocalRankFusion<T extends SearchDocument>(rankings: readonly (readonly T[])[]): T[] {
  const scores = new Map<string, { document: T; score: number; order: number }>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    ranking.forEach((document, index) => {
      if (seen.has(document.id)) return;
      seen.add(document.id);
      const entry = scores.get(document.id) ?? { document, score: 0, order: scores.size };
      entry.score += 1 / (SEARCH_RRF_K + index + 1);
      scores.set(document.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.document);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) throw new Error("embedding dimensions mismatch");
  let dot = 0,
    leftNorm = 0,
    rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  const norm = Math.sqrt(leftNorm * rightNorm);
  if (!Number.isFinite(norm) || !Number.isFinite(dot) || norm === 0) throw new Error("invalid embedding norm");
  return dot / norm;
}
