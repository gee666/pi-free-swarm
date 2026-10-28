import styles from "./HourBars.module.css";

interface HourBucket {
  hourStart: number;
  accepted: number;
}
const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function HourBars({ buckets }: { buckets: readonly HourBucket[] }) {
  const hours = buckets.slice(-12);
  const maximum = Math.max(1, ...hours.map((bucket) => bucket.accepted));
  return (
    <svg
      className={styles.chart}
      height="118"
      role="img"
      aria-label={`Accepted per hour, UTC: ${hours.map((bucket) => `${hour.format(bucket.hourStart)}: ${bucket.accepted}`).join(", ")}`}
    >
      {hours.map((bucket, index) => {
        const height = (bucket.accepted / maximum) * 96;
        const x = (index / 12) * 100;
        return (
          <g key={bucket.hourStart}>
            <rect
              x={`${x}%`}
              y={96 - height}
              height={height}
              style={{ width: "calc(100% / 12 - 4px)" }}
              fill="var(--accent)"
            />
            {index % 3 === 0 && (
              <text x={`${x}%`} y="114">
                {hour.format(bucket.hourStart)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
