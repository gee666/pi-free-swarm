import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import styles from "./Popover.module.css";
import { useAnchoredPosition, type AnchorAlign } from "./useAnchoredPosition";

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Called on Esc and on a click outside both the popover and its anchor. */
  onClose: () => void;
  align?: Exclude<AnchorAlign, "center">;
  className?: string;
  children: ReactNode;
}

export function Popover({ anchorRef, open, onClose, align = "start", className, children }: PopoverProps) {
  const popover = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(anchorRef, open, align, true);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popover.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !style) return null;
  return createPortal(
    <div ref={popover} className={cx(styles.popover, className)} style={style}>
      {children}
    </div>,
    document.body,
  );
}
