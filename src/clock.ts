// Every timer in the runtime goes through a Clock so lifecycle, watchdog and host tests can use a fake one.

export interface TimerHandle {
  cancel(): void;
}

export interface Clock {
  now(): number;
  /** Runs `fn` once after `ms`. */
  after(ms: number, fn: () => void): TimerHandle;
  /** Runs `fn` every `ms` until cancelled. */
  every(ms: number, fn: () => void): TimerHandle;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(timer) };
  },
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    return { cancel: () => clearInterval(timer) };
  },
};
