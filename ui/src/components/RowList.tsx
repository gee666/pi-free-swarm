import type { KeyboardEvent, ReactNode } from "react";

const ROW_SELECTOR = "[data-row]";

/** Spread on the focusable element of each row so ↑/↓ inside a RowList can reach it. */
export const rowFocusProps = { "data-row": "" };

/** Container that moves focus between its rows with ↑/↓. */
export function RowList({ className, children }: { className?: string; children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.findIndex((row) => row === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = current === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, current + step));
    rows[next].focus();
  };
  return (
    <div className={className} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
