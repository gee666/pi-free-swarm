import { useLayoutEffect, useRef, useState } from "react";
import { RichText } from "../../components/RichText";
import styles from "./TaskTimeline.module.css";

export function TimelineBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || expanded) return;
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <div className={styles.body}>
      <div ref={content} className={expanded ? undefined : styles.clamped}>
        <RichText text={text} />
      </div>
      {overflow && (
        <button className={styles.more} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
