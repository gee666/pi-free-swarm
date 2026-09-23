import { vi } from "vitest";
import type { SessionItem, SessionPage, SwarmEvent } from "../../../../src/api-types";
import type { EventStream, SwarmEventListener } from "../../api/useEventStream";

// Test doubles for the Work tab: an in-memory session endpoint, a controllable stream and IntersectionObserver.

const PAGE_SIZE = 50;

export const entryItem = (index: number): SessionItem => ({
  kind: "assistant_text",
  id: `e${index}:0`,
  timestamp: 1_700_000_000_000 + index * 1000,
  text: `Entry ${index}`,
});

interface SessionServerOptions {
  /** `before` pages repeat the newest entry the client already has, like a page shifted by a live append. */
  overlap?: boolean;
}

/** Serves `/session` from `entries` (one item per entry, cursor = entry index) through a mocked fetch. */
export function mockSessionServer(count: number, { overlap = false }: SessionServerOptions = {}) {
  const entries = Array.from({ length: count }, (_, index) => entryItem(index));
  const requests: URLSearchParams[] = [];
  let gate: Promise<void> | undefined;

  const page = (query: URLSearchParams): SessionPage => {
    const before = query.get("before");
    const after = query.get("after");
    let slice: SessionItem[];
    if (after !== null) slice = entries.slice(Number(after) + 1, Number(after) + 1 + PAGE_SIZE);
    else if (before !== null)
      slice = entries.slice(Math.max(0, Number(before) - PAGE_SIZE), Number(before) + (overlap ? 1 : 0));
    else slice = entries.slice(-PAGE_SIZE);
    const oldest = entries.indexOf(slice[0]);
    return {
      agent: "John",
      items: [...slice].reverse(),
      olderCursor: after === null && oldest > 0 ? String(oldest) : null,
      newestCursor:
        after !== null
          ? String(slice.length ? entries.indexOf(slice[slice.length - 1]) : Number(after))
          : entries.length === 0
            ? null
            : String(entries.length - 1),
    };
  };

  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://test",
    );
    requests.push(url.searchParams);
    await gate;
    return new Response(JSON.stringify(page(url.searchParams)), { headers: { "Content-Type": "application/json" } });
  });

  return {
    fetch,
    requests,
    append: (added: number) => {
      for (let index = 0; index < added; index += 1) entries.push(entryItem(entries.length));
    },
    /** Holds every response until the returned function is called. */
    hold: () => {
      let release = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = undefined;
          resolve();
        };
      });
      return () => release();
    },
  };
}

/** An open swarm stream whose events the test pushes with `emit`. */
export function fakeStream(): EventStream & { emit: (event: SwarmEvent) => void } {
  const listeners = new Set<SwarmEventListener>();
  return {
    status: "open",
    openCount: 1,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event) => listeners.forEach((listener) => listener(event)),
  };
}

export const sessionAppended = (agent: string): SwarmEvent => ({
  id: null,
  swarmId: 3,
  type: "session.appended",
  payload: { agent, newestCursor: "opaque" },
  createdAt: Date.now(),
});

type IntersectionCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

/** Records observed targets; `intersect()` reports every one of them as visible. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  private readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  takeRecords(): [] {
    return [];
  }

  static intersect(): void {
    for (const observer of FakeIntersectionObserver.instances) {
      if (observer.targets.size > 0) {
        observer.callback([...observer.targets].map((target) => ({ isIntersecting: true, target })));
      }
    }
  }
}
