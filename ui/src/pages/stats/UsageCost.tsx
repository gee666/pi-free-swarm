import type { UsageTotals } from "../../../../src/api-types";
import { formatUsageCost } from "../../lib/format";
import { TOKEN_CATEGORIES, type UsageCategory } from "./usageCategories";
import styles from "./Stats.module.css";

export function hasIncompleteCosts(usage: UsageTotals): boolean {
  const breakdown = usage.costBreakdown;
  return (
    !breakdown ||
    TOKEN_CATEGORIES.some(({ key }) => breakdown[key].usd === null || breakdown[key].knownRecords < breakdown.records)
  );
}

export function UsageCost({
  usage,
  category,
  label,
  compact = false,
}: {
  usage: UsageTotals;
  category: UsageCategory;
  label: string;
  compact?: boolean;
}) {
  const breakdown = usage.costBreakdown;
  const reported = breakdown?.[category];
  if (!breakdown || !reported || reported.usd === null) {
    return (
      <span className={styles.costLine} aria-label={`${label} cost not recorded`}>
        Cost not recorded
      </span>
    );
  }
  const partial = reported.knownRecords < breakdown.records;
  const value = formatUsageCost(reported.usd);
  const coverage = `Recorded for ${reported.knownRecords} of ${breakdown.records} usage records`;
  return (
    <span
      className={styles.costLine}
      title={coverage}
      aria-label={`${label} cost: ${value}${partial ? "; known subtotal" : ""}. ${coverage}`}
    >
      {value}
      {partial ? (compact ? " known" : " known subtotal") : compact ? "" : " recorded cost"}
    </span>
  );
}
