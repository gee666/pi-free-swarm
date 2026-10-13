import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, SquareTerminal } from "lucide-react";
import type { EventStream } from "../../api/useEventStream";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { PanelBody } from "../../components/Panel";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { FeedItem } from "./FeedItem";
import { useSessionFeed } from "./useSessionFeed";
import styles from "./Work.module.css";

// Within this distance of the top, new entries appear in place instead of behind the "N new" pill.
const AT_TOP_PX = 24;
// Older pages start loading this far before the end of the feed comes into view.
const PRELOAD_PX = 600;

interface SessionFeedProps {
  swarmId: string;
  agent: string;
  stream: EventStream;
}

/** Newest entries on top; scrolling down loads older pages. Mount per agent (`key={agent}`). */
export function SessionFeed({ swarmId, agent, stream }: SessionFeedProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const entries = useRef<HTMLDivElement>(null);
  // An existing entry ignores height changes from older pages appended in the same commit.
  const anchor = useRef<{ item: Element; top: number } | "top" | null>(null);
  const [unseen, setUnseen] = useState(0);
  const atTop = () => (scroller.current?.scrollTop ?? 0) <= AT_TOP_PX;

  const feed = useSessionFeed({
    swarmId,
    agent,
    stream,
    onBeforePrepend: (count) => {
      if (atTop()) {
        anchor.current = "top";
        return;
      }
      const item = entries.current?.firstElementChild;
      if (item && anchor.current === null) anchor.current = { item, top: item.getBoundingClientRect().top };
      setUnseen((value) => value + count);
    },
  });

  useLayoutEffect(() => {
    const element = scroller.current;
    const saved = anchor.current;
    anchor.current = null;
    if (!element || !saved) return;
    if (saved === "top") element.scrollTop = 0;
    else if (saved.item.isConnected) element.scrollTop += saved.item.getBoundingClientRect().top - saved.top;
  }, [feed.items]);

  const loadOlder = useRef(feed.loadOlder);
  loadOlder.current = feed.loadOlder;
  const canLoadOlder = feed.hasOlder && !feed.loadingOlder && !feed.olderError;
  const itemCount = feed.items?.length ?? 0;
  // Re-observing after every page makes the observer report again if the sentinel is still in view.
  useEffect(() => {
    const root = scroller.current;
    const target = sentinel.current;
    if (!root || !target || !canLoadOlder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadOlder.current();
      },
      { root, rootMargin: `0px 0px ${PRELOAD_PX}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadOlder, itemCount]);

  const onScroll = () => {
    if (unseen > 0 && atTop()) setUnseen(0);
  };
  const showNewest = () => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setUnseen(0);
  };

  if (feed.error) {
    return (
      <ErrorBanner action={<Button onClick={feed.retry}>Retry</Button>}>
        {`Could not load the session: ${feed.error.message}`}
      </ErrorBanner>
    );
  }
  if (!feed.items) return <SkeletonRows />;
  if (feed.items.length === 0 && !feed.newerError) {
    return <EmptyState icon={SquareTerminal} text="No session entries yet" />;
  }

  return (
    <div className={styles.feedFrame}>
      {unseen > 0 && (
        <button type="button" className={styles.newPill} onClick={showNewest}>
          {`${unseen} new`}
          <Icon icon={ArrowUp} size="status" />
        </button>
      )}
      <PanelBody
        ref={scroller}
        className={styles.feedScroller}
        onScroll={onScroll}
        role="feed"
        aria-label={`Session of ${agent}`}
        aria-busy={feed.loadingOlder}
      >
        {feed.newerError && (
          <ErrorBanner action={<Button onClick={feed.retryNewer}>Retry</Button>}>
            {`Could not load new entries: ${feed.newerError.message}`}
          </ErrorBanner>
        )}
        <div ref={entries} className={styles.feed}>
          {feed.items.map((item) => (
            <FeedItem key={item.id} item={item} agent={agent} />
          ))}
        </div>
        {feed.loadingOlder && <SkeletonRows count={3} />}
        {feed.olderError && (
          <ErrorBanner action={<Button onClick={feed.loadOlder}>Retry</Button>}>
            {`Could not load older entries: ${feed.olderError.message}`}
          </ErrorBanner>
        )}
        {canLoadOlder && <div ref={sentinel} className={styles.sentinel} />}
      </PanelBody>
    </div>
  );
}
