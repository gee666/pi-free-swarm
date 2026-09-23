// Compact numbers for the terminal tool box and the model-facing result. The board has its own
// formatters in ui/src/lib; the UI may not import backend code beyond limits/api-types, so they stay separate.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** "45s", "12m", "1h 04m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, ms);
  if (total < MINUTE) return `${Math.floor(total / SECOND)}s`;
  if (total < HOUR) return `${Math.floor(total / MINUTE)}m`;
  const minutes = Math.floor((total % HOUR) / MINUTE);
  return `${Math.floor(total / HOUR)}h ${String(minutes).padStart(2, "0")}m`;
}

/** "$4.12" */
export function formatCost(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/** "1.9M", "412k", "950". */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${scaled(count / 1_000_000)}M`;
  if (count >= 1_000) return `${scaled(count / 1_000)}k`;
  return String(Math.round(count));
}

// One decimal below 10 of a unit, whole numbers above.
function scaled(value: number): string {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The board page of one swarm, from the host's base URL (`http://127.0.0.1:3010`). */
export function swarmBoardUrl(baseUrl: string | null, swarmId: number): string | null {
  return baseUrl === null ? null : `${baseUrl.replace(/\/$/, "")}/s/${swarmId}`;
}
