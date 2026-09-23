import type { SessionItem } from "../../../../src/api-types";

const idsOf = (items: readonly SessionItem[]) => new Set(items.map((item) => item.id));

/** Puts an older page below the feed, skipping items already shown (a live prepend can overlap a page). */
export function appendOlder(items: SessionItem[], older: readonly SessionItem[]): SessionItem[] {
  const known = idsOf(items);
  const fresh = older.filter((item) => !known.has(item.id));
  return fresh.length === 0 ? items : [...items, ...fresh];
}

export interface Prepended {
  items: SessionItem[];
  /** How many items are new on top. */
  added: number;
}

/** Puts newer items on top; an item already shown is replaced in place, e.g. a tool call that finished. */
export function prependNewer(items: SessionItem[], newer: readonly SessionItem[]): Prepended {
  const known = idsOf(items);
  const fresh = newer.filter((item) => !known.has(item.id));
  const replaced = new Map(newer.filter((item) => known.has(item.id)).map((item) => [item.id, item]));
  const kept = replaced.size === 0 ? items : items.map((item) => replaced.get(item.id) ?? item);
  return { items: fresh.length === 0 ? kept : [...fresh, ...kept], added: fresh.length };
}
