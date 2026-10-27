import { Hourglass } from "lucide-react";
import { Tooltip } from "./Tooltip";
import styles from "./StatusGlyph.module.css";

export type WorkStatus =
  "unlinked" | "incomplete" | "satisfied" | "blocked" | "new" | "claimed" | "in_progress" | "review" | "accepted";

export const statusLabels: Record<WorkStatus, string> = {
  unlinked: "Unlinked",
  incomplete: "Incomplete",
  satisfied: "Satisfied",
  blocked: "Blocked",
  new: "New",
  claimed: "Claimed",
  in_progress: "In progress",
  review: "In review",
  accepted: "Accepted",
};

export function StatusGlyph({
  status,
  waiting = false,
  label,
}: {
  status: WorkStatus;
  waiting?: boolean;
  label?: string;
}) {
  const text = label ?? (waiting ? "Waiting" : statusLabels[status]);
  return (
    <Tooltip content={text}>
      <span role="img" aria-label={text} className={styles.glyph}>
        {waiting ? (
          <Hourglass size={14} aria-hidden="true" className={styles.waiting} />
        ) : (
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" className={styles[status]}>
            <circle cx="7" cy="7" r="6" className={styles.ring} />
            {status === "in_progress" && <path d="M7 1a6 6 0 0 0 0 12Z" fill="currentColor" />}
            {(status === "claimed" || status === "review") && <circle cx="7" cy="7" r="2" fill="currentColor" />}
            {status === "blocked" && <path d="m3 11 8-8" stroke="currentColor" />}
            {(status === "satisfied" || status === "accepted") && <path d="m4 7 2 2 4-4" className={styles.check} />}
          </svg>
        )}
      </span>
    </Tooltip>
  );
}
