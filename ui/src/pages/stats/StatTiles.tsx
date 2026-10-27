import type { StatsTotals } from "../../../../src/api-types";
import { StatTile } from "../../components/StatTile";
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
            <StatTile key={tile.label} {...tile} />
          ))}
        </dl>
        <dl className={styles.tiles}>
          {TOKEN_CATEGORIES.map(({ key, label }) => (
            <StatTile
              key={key}
              label={`${label} tokens`}
              value={formatTokens(totals[key])}
              detail={<UsageCost usage={totals} category={key} label={label} />}
            />
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
