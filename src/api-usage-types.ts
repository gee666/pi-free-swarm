export interface ReportedUsageCosts {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface UsageCostComponent {
  /** Reported USD subtotal, or null when no row supplied this category. */
  usd: number | null;
  knownRecords: number;
}

export interface UsageCostBreakdown {
  /** Completed native reports: assistant, compaction, tool and standalone usage. */
  records: number;
  input: UsageCostComponent;
  output: UsageCostComponent;
  cacheRead: UsageCostComponent;
  cacheWrite: UsageCostComponent;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD. */
  cost: number;
  /** Absent when no category costs were reported; known subtotals may be partial. */
  costBreakdown?: UsageCostBreakdown;
  /** Assistant messages counted; every native usage kind contributes tokens and cost. */
  turns: number;
}
