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
      const viewportWidth = window.innerWidth;
      const maxWidth = Math.max(0, viewportWidth - 2 * VIEWPORT_MARGIN);
      const anchorCenter = rect.left + rect.width / 2;
      const nearRight = anchorCenter > viewportWidth / 2;
      const center =
        anchorCenter < viewportWidth / 4 || anchorCenter > (viewportWidth * 3) / 4 ? viewportWidth / 2 : anchorCenter;
      const horizontal: CSSProperties =
        align === "center"
          ? { left: center, transform: "translateX(-50%)" }
          : align === "end"
            ? nearRight
              ? { right: Math.max(VIEWPORT_MARGIN, viewportWidth - rect.right) }
              : { left: VIEWPORT_MARGIN }
            : nearRight
              ? { right: VIEWPORT_MARGIN }
              : { left: Math.max(VIEWPORT_MARGIN, rect.left) };
      const availableWidth = Math.max(
        0,
        align === "center"
          ? 2 * Math.min(center - VIEWPORT_MARGIN, viewportWidth - center - VIEWPORT_MARGIN)
          : typeof horizontal.right === "number"
            ? viewportWidth - horizontal.right - VIEWPORT_MARGIN
            : typeof horizontal.left === "number"
              ? viewportWidth - horizontal.left - VIEWPORT_MARGIN
              : maxWidth,
      );
      setStyle({
        position: "fixed",
        minWidth: matchWidth ? Math.min(rect.width, availableWidth) : undefined,
        maxWidth: Math.min(maxWidth, availableWidth),
        ...vertical,
        ...horizontal,
      });
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
