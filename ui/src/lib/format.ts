const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1.23" */
export function formatCost(dollars: number): string {
  return usd.format(dollars);
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** "1h 04m", "12m 30s" or "45s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

const TOKEN_UNITS = [
  { size: 1_000_000, suffix: "M" },
  { size: 1_000, suffix: "k" },
];

// One decimal below 10 of a unit ("1.9M"), whole numbers above ("412k").
function scaled(value: number): string {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
}

/** "1.9M", "412k", "950". */
export function formatTokens(count: number): string {
  for (const unit of TOKEN_UNITS) {
    const text = scaled(count / unit.size);
    if (Number.parseFloat(text) >= 1) return `${text}${unit.suffix}`;
  }
  return String(Math.round(count));
}
