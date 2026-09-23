// Manual Clock: timers fire only from advance(), in due order.
import type { Clock, TimerHandle } from "../../src/clock.js";

interface Timer {
  due: number;
  seq: number;
  interval: number | null;
  fn: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  #now: number;
  #seq = 0;
  #timers: Timer[] = [];

  constructor(start = 1_000_000) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  after(ms: number, fn: () => void): TimerHandle {
    return this.#add(ms, null, fn);
  }

  every(ms: number, fn: () => void): TimerHandle {
    return this.#add(ms, ms, fn);
  }

  /** Number of timers still scheduled. */
  get pending(): number {
    return this.#timers.filter((timer) => !timer.cancelled).length;
  }

  /** Milliseconds until the next scheduled timer, null when none. */
  nextDelay(): number | null {
    const dues = this.#timers.filter((timer) => !timer.cancelled).map((timer) => timer.due);
    return dues.length > 0 ? Math.min(...dues) - this.#now : null;
  }

  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const next = this.#timers
        .filter((timer) => !timer.cancelled && timer.due <= end)
        .sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (!next) break;
      this.#now = next.due;
      if (next.interval === null) next.cancelled = true;
      else next.due += next.interval;
      next.fn();
    }
    this.#now = end;
    this.#timers = this.#timers.filter((timer) => !timer.cancelled);
  }

  #add(ms: number, interval: number | null, fn: () => void): TimerHandle {
    const timer: Timer = { due: this.#now + ms, seq: this.#seq++, interval, fn, cancelled: false };
    this.#timers.push(timer);
    return { cancel: () => (timer.cancelled = true) };
  }
}
