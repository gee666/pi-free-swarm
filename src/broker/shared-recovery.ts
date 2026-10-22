/** Serializes only explicitly classified failures within an effective launch configuration. */
export class SharedRecovery {
  readonly #groups = new Map<string, { leader: string; waiting: Map<string, () => void> }>();

  recover(key: string, name: string, attempt: () => void): void {
    const group = this.#groups.get(key);
    if (!group) {
      this.#groups.set(key, { leader: name, waiting: new Map() });
      attempt();
    } else if (group.leader === name) attempt();
    else group.waiting.set(name, attempt);
  }

  ready(name: string): void {
    for (const [key, group] of this.#groups) {
      if (group.leader !== name) continue;
      this.#groups.delete(key);
      for (const attempt of group.waiting.values()) attempt();
    }
  }

  /** Exhaustion remains visible and never silently gives every waiter another probe. */
  failed(name: string): string[] {
    for (const [key, group] of this.#groups) {
      if (group.leader !== name) continue;
      this.#groups.delete(key);
      return [...group.waiting.keys()];
    }
    return [];
  }

  close(): void {
    this.#groups.clear();
  }
}
