import type { AgentCrash } from "../agents/supervisor.js";

interface Candidate {
  name: string;
  launchKey: string;
  launchFirst(): Promise<void>;
}

/** Admission is released by a real agent_start, never by spawn or queue acceptance. */
export class StartupAdmission {
  readonly #groups = new Map<string, { ready: boolean; first: string; waiting: Candidate[] }>();
  readonly #starting = new Set<string>();
  #closed = false;

  constructor(
    readonly launch: (candidate: Candidate) => void,
    readonly fail: (error: Error) => void,
  ) {}

  admit(candidate: Candidate): void {
    if (this.#closed) return;
    const group = this.#groups.get(candidate.launchKey);
    if (!group) {
      this.#groups.set(candidate.launchKey, { ready: false, first: candidate.name, waiting: [] });
      this.#starting.add(candidate.name);
      this.launch(candidate);
    } else if (group.ready) this.launch(candidate);
    else group.waiting.push(candidate);
  }

  ready(candidate: Candidate): void {
    if (this.#closed) return;
    this.#starting.delete(candidate.name);
    const group = this.#groups.get(candidate.launchKey);
    if (!group || group.ready || group.first !== candidate.name) return;
    group.ready = true;
    for (const waiting of group.waiting.splice(0)) this.launch(waiting);
  }

  crashed(candidate: Candidate, crash: AgentCrash): boolean {
    if (this.#closed || !this.#starting.has(candidate.name)) return false;
    if (crash.reason === "protocol_overflow") {
      this.isolatedFailure(candidate);
      return false;
    }
    // These failures have explicit launch-path evidence, unlike arbitrary stderr text.
    if (!crash.fatal || (crash.reason !== "extension_load_failed" && !crash.sharedStartupFailure)) return false;
    this.close();
    this.fail(new Error(`Worker ${candidate.name} failed shared startup: ${crash.message}`));
    return true;
  }

  isolatedFailure(candidate: Candidate): void {
    if (this.#closed || !this.#starting.delete(candidate.name)) return;
    const group = this.#groups.get(candidate.launchKey);
    const next = group?.waiting.shift();
    if (!group || !next) {
      this.#groups.delete(candidate.launchKey);
      return;
    }
    group.first = next.name;
    this.#starting.add(next.name);
    this.launch(next);
  }

  remove(candidate: Candidate): void {
    const group = this.#groups.get(candidate.launchKey);
    if (group) group.waiting = group.waiting.filter((waiting) => waiting.name !== candidate.name);
    this.isolatedFailure(candidate);
  }

  close(): void {
    this.#closed = true;
    this.#groups.clear();
    this.#starting.clear();
  }
}
