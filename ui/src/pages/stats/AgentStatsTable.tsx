import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { AgentStats, StatsTotals } from "../../../../src/api-types";
import { Avatar } from "../../components/Avatar";
import { AgentName } from "../../components/AgentName";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Indicators";
import { cx } from "../../lib/cx";
import { formatCost, formatDuration, formatTokens } from "../../lib/format";
import { agentDotStatus } from "../../lib/swarmStatus";
import { DEFAULT_SORT, isTextKey, nextSort, sortAgents, type Sort, type SortKey } from "./sortAgents";
import styles from "./Stats.module.css";

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "name", label: "Agent" },
  { key: "status", label: "Status" },
  { key: "activeTimeMs", label: "Active time" },
  { key: "input", label: "Tokens in" },
  { key: "output", label: "Tokens out" },
  { key: "cacheRead", label: "Cache" },
  { key: "cost", label: "Cost" },
];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Usage cells shared by agent rows and the total row. */
function UsageCells({ usage }: { usage: AgentStats | StatsTotals }) {
  return (
    <>
      <td className={styles.number}>{formatDuration(usage.activeTimeMs)}</td>
      <td className={styles.number}>{formatTokens(usage.input)}</td>
      <td className={styles.number}>{formatTokens(usage.output)}</td>
      <td className={styles.number}>{formatTokens(usage.cacheRead)}</td>
      <td className={styles.number}>{formatCost(usage.cost)}</td>
    </>
  );
}

function ShareBar({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return (
    <span className={styles.shareTrack} role="img" aria-label={`${percent}% of the cost`}>
      <span className={styles.shareFill} style={{ width: `${percent}%` }} />
    </span>
  );
}

function SortHeader({ column, sort, onSort }: { column: (typeof COLUMNS)[number]; sort: Sort; onSort: () => void }) {
  const active = sort.key === column.key;
  const direction = sort.descending ? "descending" : "ascending";
  return (
    <th scope="col" aria-sort={active ? direction : "none"} className={cx(!isTextKey(column.key) && styles.number)}>
      <button type="button" className={styles.sortButton} onClick={onSort}>
        {column.label}
        {active && <Icon icon={sort.descending ? ChevronDown : ChevronUp} size="status" />}
      </button>
    </th>
  );
}

/** Per-agent usage, sortable, with the swarm total pinned at the bottom. */
export function AgentStatsTable({
  agents,
  totals,
  selected,
}: {
  agents: readonly AgentStats[];
  totals: StatsTotals;
  selected?: string;
}) {
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const selectedRow = useRef<HTMLTableRowElement>(null);
  const matches = (name: string) => name.toLowerCase() === selected?.toLowerCase();
  const present = agents.some(({ name }) => matches(name));
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "center" });
  }, [selected, present]);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <SortHeader
              key={column.key}
              column={column}
              sort={sort}
              onSort={() => setSort((current) => nextSort(current, column.key))}
            />
          ))}
          <th scope="col" className={styles.shareColumn}>
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {sortAgents(agents, sort).map((agent) => (
          <tr
            key={agent.name}
            ref={matches(agent.name) ? selectedRow : undefined}
            aria-current={matches(agent.name) ? "true" : undefined}
            className={matches(agent.name) ? styles.selected : undefined}
          >
            <th scope="row" aria-label={agent.name}>
              <span className={styles.agent}>
                <Avatar name={agent.name} size="sm" />
                <AgentName name={agent.name} />
              </span>
            </th>
            <td>
              <span className={styles.status}>
                <StatusDot status={agentDotStatus(agent.status)} label="" />
                {capitalize(agent.status)}
              </span>
            </td>
            <UsageCells usage={agent} />
            <td className={styles.shareColumn}>
              <ShareBar share={totals.cost > 0 ? agent.cost / totals.cost : 0} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td />
          <UsageCells usage={totals} />
          <td className={styles.shareColumn} />
        </tr>
      </tfoot>
    </table>
  );
}
