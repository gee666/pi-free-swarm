import styles from "./Donut.module.css";

export interface DonutSegment {
  label: string;
  count: number;
  color: string;
}

export function Donut({
  label,
  segments,
  value,
  total,
  completeLabel,
}: {
  label: string;
  segments: readonly DonutSegment[];
  value: number;
  total: number;
  completeLabel: string;
}) {
  let offset = 0;
  return (
    <svg
      className={styles.donut}
      width="140"
      height="140"
      viewBox="0 0 140 140"
      role="img"
      aria-label={`${label}: ${segments.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`).join(", ")}. ${value} of ${total} ${completeLabel}`}
    >
      <circle cx="70" cy="70" r="62" fill="none" stroke="var(--bg-chip)" strokeWidth="16" />
      {segments.map((segment) => {
        const share = total > 0 ? (segment.count / total) * 100 : 0;
        const start = offset;
        offset += share;
        return (
          share > 0 && (
            <circle
              key={segment.label}
              cx="70"
              cy="70"
              r="62"
              fill="none"
              stroke={segment.color}
              strokeWidth="16"
              pathLength="100"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
              transform="rotate(-90 70 70)"
            />
          )
        );
      })}
      <text x="70" y="66" textAnchor="middle" className={styles.value}>
        {value}
      </text>
      <text x="70" y="86" textAnchor="middle" className={styles.caption}>
        of {total} {completeLabel}
      </text>
    </svg>
  );
}
