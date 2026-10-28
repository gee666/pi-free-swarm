import { useState } from "react";
import { Link } from "react-router-dom";
import type { CriteriaCoverage } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { Panel, PanelHeader } from "../../components/Panel";
import styles from "./Dashboard.module.css";

export function DashboardGroups({ swarmId, groups }: { swarmId: string; groups: CriteriaCoverage[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...groups].sort(
    (a, b) => (a.total ? a.satisfied / a.total : 0) - (b.total ? b.satisfied / b.total : 0),
  );
  return (
    <Panel>
      <PanelHeader title="Criteria by group" />
      {sorted.length === 0 && <p className={styles.empty}>No criteria yet</p>}
      {sorted.slice(0, all ? undefined : 10).map((group) => (
        <Link
          key={group.group}
          aria-label={`${group.group} ${group.satisfied}/${group.total}`}
          className={styles.groupRow}
          to={`/s/${swarmId}/criteria?group=${encodeURIComponent(group.group)}`}
        >
          <span className={styles.groupName}>{group.group}</span>
          <span className={styles.track} aria-hidden="true">
            <span style={{ width: `${group.total ? (group.satisfied / group.total) * 100 : 0}%` }} />
          </span>
          <span className={styles.fraction}>
            {group.satisfied}/{group.total}
          </span>
        </Link>
      ))}
      {!all && groups.length > 10 && (
        <Button className={styles.showAll} size="sm" onClick={() => setAll(true)}>
          Show all ({groups.length})
        </Button>
      )}
    </Panel>
  );
}
