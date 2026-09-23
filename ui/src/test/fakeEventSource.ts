import { vi } from "vitest";
import type { SwarmEvent } from "../../../src/api-types";

/** Stand-in for EventSource in page tests: `open()` and `emit(event)` drive useEventStream. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(event: SwarmEvent): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/** Replaces the global EventSource until `vi.unstubAllGlobals()`; returns the latest instance on demand. */
export function installFakeEventSource(): () => FakeEventSource {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return () => {
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error("No EventSource was opened");
    return source;
  };
}
