import { headerMessageIds } from "./rpc-events.js";

/** Authorization dies with a process. Queue acceptance alone never advances durable reads. */
export class MessageObservation {
  readonly #prompts = new Map<symbol, ReadonlySet<number>>();
  readonly #observed = new Set<number>();

  sent(ids: readonly number[]): symbol {
    const token = Symbol();
    if (ids.length) this.#prompts.set(token, new Set(ids));
    return token;
  }

  rejected(token: symbol): void {
    this.#prompts.delete(token);
  }

  observed(text: string): number[] {
    const authorized = new Set([...this.#prompts.values()].flatMap((ids) => [...ids]));
    const fresh = headerMessageIds(text).filter((id) => authorized.has(id) && !this.#observed.has(id));
    for (const id of fresh) this.#observed.add(id);
    for (const [token, ids] of this.#prompts) {
      if ([...ids].every((id) => this.#observed.has(id))) this.#prompts.delete(token);
    }
    return fresh;
  }
}
