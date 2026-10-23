type Cleanup = () => void | Promise<void>;

/** Run-local ownership. Quiesce callbacks before joining children, then release ownership. */
export class RunResources {
  readonly #quiesce: Cleanup[] = [];
  readonly #join: Cleanup[] = [];
  readonly #release: Cleanup[] = [];
  readonly #pending = new Set<Promise<void>>();
  readonly #errors: unknown[] = [];
  #closing = false;
  #closed: Promise<void> | undefined;

  add(phase: "quiesce" | "join" | "release", cleanup: Cleanup): () => void {
    const owned = this.#list(phase);
    if (this.#closing) this.#track(cleanup);
    else owned.push(cleanup);
    return () => {
      const index = owned.indexOf(cleanup);
      if (index >= 0) owned.splice(index, 1);
    };
  }

  /** Register acquisition before it starts so shutdown also joins late resources. */
  acquire<T>(
    acquisition: Promise<T>,
    phase: "quiesce" | "join" | "release",
    cleanup: (value: T) => void | Promise<void>,
  ): Promise<T> {
    const acquired = acquisition.then((value) => {
      this.add(phase, () => cleanup(value));
      return value;
    });
    const pending = acquired.then(
      () => undefined,
      () => undefined,
    );
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending));
    return acquired;
  }

  close(): Promise<void> {
    this.#closed ??= this.#close();
    return this.#closed;
  }

  #list(phase: "quiesce" | "join" | "release"): Cleanup[] {
    return phase === "quiesce" ? this.#quiesce : phase === "join" ? this.#join : this.#release;
  }

  #track(cleanup: Cleanup): void {
    const pending = Promise.resolve()
      .then(cleanup)
      .catch((error: unknown) => {
        this.#errors.push(error);
      });
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending));
  }

  async #drain(): Promise<void> {
    while (this.#pending.size) await Promise.all(this.#pending);
  }

  async #close(): Promise<void> {
    this.#closing = true;
    for (const phase of [this.#quiesce, this.#join, this.#release]) {
      for (const cleanup of phase.splice(0)) this.#track(cleanup);
      await this.#drain();
    }
    if (this.#errors.length) throw new AggregateError(this.#errors, "Run resource cleanup failed.");
  }
}
