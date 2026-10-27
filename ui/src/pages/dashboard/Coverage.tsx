import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { CriteriaCoverage } from "../../../../src/api-types";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState } from "../../components/States";
import { RowList, rowFocusProps } from "../../components/RowList";
import styles from "./Dashboard.module.css";

const SEGMENTS = ["satisfied", "blocked", "incomplete", "unlinked"] satisfies (keyof Pick<
  CriteriaCoverage,
  "satisfied" | "blocked" | "incomplete" | "unlinked"
>)[];

export function Coverage({ swarmId, groups }: { swarmId: string; groups: CriteriaCoverage[] }) {
  return (
    <div>
      <Panel inset>
        <PanelHeader title="Coverage by group" />
        {groups.length === 0 ? (
          <EmptyState icon={ListChecks} text="No criteria yet" />
        ) : (
          <RowList>
            {groups.map((group) => (
              <Link
                {...rowFocusProps}
                key={group.group}
                className={styles.coverageRow}
                aria-label={`${group.group} ${group.satisfied}/${group.total}`}
                to={`/s/${swarmId}/criteria?group=${encodeURIComponent(group.group)}`}
              >
                <span className={styles.groupName}>{group.group}</span>
                <span
                  className={styles.track}
                  role="img"
                  aria-label={`${group.group}: ${SEGMENTS.map((key) => `${group[key]} ${key}`).join(", ")}`}
                >
                  {SEGMENTS.filter((key) => group[key] > 0).map((key) => (
                    <span
                      key={key}
                      className={styles[key]}
                      style={{ width: `${group.total ? (group[key] / group.total) * 100 : 0}%` }}
                    />
                  ))}
                </span>
                <span>
                  {group.satisfied}/{group.total}
                </span>
              </Link>
            ))}
          </RowList>
        )}
      </Panel>
      <p className={styles.legend}>
        {SEGMENTS.map((key) => (
          <span key={key}>
            <i className={styles[key]} />
            {key[0].toUpperCase() + key.slice(1)}
          </span>
        ))}
      </p>
    </div>
  );
}
