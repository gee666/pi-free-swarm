export type RunPhase = "created" | "active" | "draining" | "ending" | "closed";

/** Admission and shutdown are monotonic; budget draining still records active usage. */
export class RunLifecycle {
  #phase: RunPhase = "created";
  get phase(): RunPhase {
    return this.#phase;
  }
  get admitsWork(): boolean {
    return this.#phase === "active";
  }
  get ending(): boolean {
    return this.#phase === "ending" || this.#phase === "closed";
  }

  activate(): void {
    if (this.#phase !== "created") throw new Error(`Cannot activate a ${this.#phase} run.`);
    this.#phase = "active";
  }
  drain(): boolean {
    if (this.#phase !== "active") return false;
    this.#phase = "draining";
    return true;
  }
  end(): boolean {
    if (this.ending) return false;
    this.#phase = "ending";
    return true;
  }
  close(): void {
    if (this.#phase !== "ending") throw new Error(`Cannot close a ${this.#phase} run.`);
    this.#phase = "closed";
  }
}
