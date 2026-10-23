import type { StatsTotals } from "../../../../src/api-types";
import { cx } from "../../lib/cx";
import { formatCost, formatDuration, formatTokens } from "../../lib/format";
import { TOKEN_CATEGORIES } from "./usageCategories";
import { hasIncompleteCosts, UsageCost } from "./UsageCost";
import styles from "./Stats.module.css";

const count = new Intl.NumberFormat("en-US");

export function StatTiles({ totals }: { totals: StatsTotals }) {
  const summary = [
    { label: "Cost", value: formatCost(totals.cost), accent: true },
    { label: "Wall time", value: formatDuration(totals.wallTimeMs) },
    { label: "Agent time", value: formatDuration(totals.activeTimeMs) },
    { label: "Messages · Posts", value: `${count.format(totals.messages)} · ${count.format(totals.posts)}` },
  ];
  return (
    <section aria-label="Swarm usage totals" className={styles.totals}>
      <div className={styles.tokenHeading}>
        <h3>Usage totals</h3>
        <p className={styles.cacheTotal}>
          Cache tokens <strong>{formatTokens(totals.cacheRead + totals.cacheWrite)}</strong> <span>read + write</span>
        </p>
      </div>
      <div className={styles.tileGroups}>
        <dl className={styles.tiles}>
          {summary.map((tile) => (
            <div key={tile.label} className={styles.tile}>
              <dt className={styles.tileLabel}>{tile.label}</dt>
              <dd className={cx(styles.tileValue, tile.accent && styles.accent)}>{tile.value}</dd>
            </div>
          ))}
        </dl>
        <dl className={styles.tiles}>
          {TOKEN_CATEGORIES.map(({ key, label }) => (
            <div key={key} className={styles.tile}>
              <dt className={styles.tileLabel}>{label} tokens</dt>
              <dd className={styles.tileValue}>{formatTokens(totals[key])}</dd>
              <dd className={styles.tileCost}>
                <UsageCost usage={totals} category={key} label={label} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {hasIncompleteCosts(totals) && (
        <p className={styles.costNote}>
          Some per-type costs were not recorded. Known subtotals are labelled; missing costs are not treated as zero.
          Total cost is tracked separately.
        </p>
      )}
    </section>
  );
}
