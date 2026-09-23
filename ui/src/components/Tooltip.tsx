import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import styles from "./Tooltip.module.css";
import { useAnchoredPosition } from "./useAnchoredPosition";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Class for the wrapper, e.g. to let truncated text shrink. */
  className?: string;
}

/** Shows `content` on hover or keyboard focus of the wrapped element. */
export function Tooltip({ content, children, className }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const style = useAnchoredPosition(anchor, open, "center");
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span
      ref={anchor}
      className={cx(styles.anchor, className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        style &&
        createPortal(
          <span role="tooltip" id={id} className={styles.tooltip} style={style}>
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
