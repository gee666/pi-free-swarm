import { useId, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { Popover } from "./Popover";
import styles from "./AcceptanceSummary.module.css";
import taskStyles from "./InitialTask.module.css";

export function InitialTask({ task }: { task: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <>
      <button
        ref={anchor}
        className={styles.pill}
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen(!open)}
      >
        Initial task
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="end" className={styles.summary}>
        <section id={contentId} aria-label="Initial task" className={taskStyles.task}>
          <h3>Initial task</h3>
          <Markdown source={task} />
        </section>
      </Popover>
    </>
  );
}
