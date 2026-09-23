import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export type AnchorAlign = "start" | "center" | "end";

const GAP = 8;
const VIEWPORT_MARGIN = 16;

/**
 * Fixed-position style that places a floating element next to its anchor. Floating elements are
 * portalled to <body> because panels clip their overflow; they open on the side with more room.
 */
export function useAnchoredPosition(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  align: AnchorAlign,
  /** At least as wide as the anchor, e.g. a dropdown under its button. */
  matchWidth = false,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    const update = () => {
      const element = anchor.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const opensDown = spaceBelow >= rect.top;
      const vertical: CSSProperties = opensDown
        ? { top: rect.bottom + GAP, maxHeight: spaceBelow - GAP - VIEWPORT_MARGIN }
        : { bottom: window.innerHeight - rect.top + GAP, maxHeight: rect.top - GAP - VIEWPORT_MARGIN };
      const horizontal: CSSProperties =
        align === "end"
          ? { right: window.innerWidth - rect.right }
          : align === "center"
            ? { left: rect.left + rect.width / 2, transform: "translateX(-50%)" }
            : { left: rect.left };
      setStyle({ position: "fixed", minWidth: matchWidth ? rect.width : undefined, ...vertical, ...horizontal });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, open, align, matchWidth]);

  return style;
}
