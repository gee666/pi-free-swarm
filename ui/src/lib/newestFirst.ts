interface DatedRecord {
  id: number;
  createdAt: number;
}

export function newestFirst<T extends DatedRecord>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.createdAt - left.createdAt || right.id - left.id);
}

export function insertNewest<T extends DatedRecord>(items: T[], item: T): T[] {
  return items.some((existing) => existing.id === item.id) ? items : newestFirst([...items, item]);
}
