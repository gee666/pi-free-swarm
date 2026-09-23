import type { StatsTotals } from "../../../../src/api-types";
import { cx } from "../../lib/cx";
import { formatCost, formatDuration, formatTokens } from "../../lib/format";
import styles from "./Stats.module.css";

const count = new Intl.NumberFormat("en-US");

/** Swarm totals above the table; only the cost is accented. */
export function StatTiles({ totals }: { totals: StatsTotals }) {
  const tiles = [
    { label: "Cost", value: formatCost(totals.cost), accent: true },
    { label: "Wall time", value: formatDuration(totals.wallTimeMs) },
    { label: "Agent time", value: formatDuration(totals.activeTimeMs) },
    { label: "Tokens in", value: formatTokens(totals.input) },
    { label: "Tokens out", value: formatTokens(totals.output) },
    { label: "Messages · Posts", value: `${count.format(totals.messages)} · ${count.format(totals.posts)}` },
  ];
  return (
    <dl className={styles.tiles}>
      {tiles.map((tile) => (
        <div key={tile.label} className={styles.tile}>
          <dt className={styles.tileLabel}>{tile.label}</dt>
          <dd className={cx(styles.tileValue, tile.accent && styles.accent)}>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
