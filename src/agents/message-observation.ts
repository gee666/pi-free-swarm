import { headerMessageIds } from "./rpc-events.js";

/** Authorization dies with a process. Queue acceptance alone never advances durable reads. */
export class MessageObservation {
  readonly #prompts = new Map<symbol, { ids: ReadonlySet<number>; text: string }>();
  readonly #observed = new Set<number>();

  sent(ids: readonly number[], text: string): symbol {
    const token = Symbol();
    if (ids.length && text) this.#prompts.set(token, { ids: new Set(ids), text });
    return token;
  }

  rejected(token: symbol): void {
    this.#prompts.delete(token);
  }

  settled(): void {
    this.#prompts.clear();
    this.#observed.clear();
  }

  observed(text: string): number[] {
    const authorized = new Set<number>();
    for (const prompt of this.#prompts.values()) {
      if (text.includes(prompt.text)) for (const id of prompt.ids) authorized.add(id);
    }
    const fresh: number[] = [];
    for (const id of headerMessageIds(text)) {
      if (!authorized.has(id) || this.#observed.has(id)) continue;
      this.#observed.add(id);
      fresh.push(id);
    }
    for (const [token, prompt] of this.#prompts) {
      if ([...prompt.ids].every((id) => this.#observed.has(id))) this.#prompts.delete(token);
    }
    return fresh;
  }
}
