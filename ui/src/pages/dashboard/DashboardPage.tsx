import { Link, useParams } from "react-router-dom";
import { Check, LayoutDashboard, ListChecks, MessageSquare } from "lucide-react";
import type { DashboardResponse } from "../../../../src/api-types";
import { RUN_LABELS, useDashboard } from "../../api/dashboard";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Button } from "../../components/Button";
import { FileLink } from "../../components/FilePreview";
import { IdLink } from "../../components/IdLink";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList, rowFocusProps } from "../../components/RowList";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { StatTile } from "../../components/StatTile";
import { StatusGlyph } from "../../components/StatusGlyph";
import { Tooltip } from "../../components/Tooltip";
import { Coverage } from "./Coverage";
import { activityLabel, gateDetail, GATE_FILTERS, GATE_LABELS } from "./dashboardModel";
import { relativeTime, shortDuration } from "../../lib/time";
import styles from "./Dashboard.module.css";

function timeAgo(epochMs: number): string {
  const time = relativeTime(epochMs);
  return time === "just now" ? time : `${time} ago`;
}

function Numbers({ data }: { data: DashboardResponse }) {
  const c = data.counts;
  const tiles = [
    ["Criteria satisfied", `${c.satisfied}/${c.criteria}`],
    ["Unlinked", c.unlinked],
    ["Blocked", c.blocked],
    ["Tasks accepted", `${c.accepted}/${c.tasks}`],
    ["In progress", c.inProgress],
    ["In review", c.inReview],
    ["Waiting", c.waiting],
    ["Runnable", c.runnable],
    ["Accepted · 15 min", data.velocity.accepted15Minutes],
    ["Accepted · 60 min", data.velocity.accepted60Minutes],
  ] satisfies [string, string | number][];
  return (
    <Panel inset aria-label="Numbers">
      <PanelHeader title="Numbers" />
      <dl className={styles.tiles}>
        {tiles.map(([label, value]) => (
          <StatTile key={label} label={label} value={value} />
        ))}
        <StatTile
          label="ETA"
          value={
            data.etaMs === null ? (
              <Tooltip content="Needs 30 min of run time and 5 accepted tasks in the last hour">
                <span tabIndex={0}>Unknown</span>
              </Tooltip>
            ) : (
              `~${shortDuration(data.etaMs)}`
            )
          }
        />
      </dl>
    </Panel>
  );
}

export function DashboardPage() {
  const { id: swarmId = "" } = useParams();
  const state = useDashboard();
  const data = state.data;
  const root = `/s/${swarmId}/`;
  return (
    <Panel aria-label="Dashboard">
      <PanelBody>
        <div className={styles.content}>
          {state.error && (
            <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
          )}
          {!data ? (
            !state.error && <SkeletonRows />
          ) : (
            <>
              <header className={styles.runHeader}>
                <div>
                  <h1>{RUN_LABELS[data.header.state]}</h1>
                  <p>
                    Run {data.header.run} · {data.header.agentCount} agents ·{" "}
                    {data.header.startedAt === null ? "not started" : `started ${timeAgo(data.header.startedAt)}`}
                  </p>
                </div>
              </header>
              <Panel inset>
                <PanelHeader title="Stop rules" />
                <RowList>
                  {data.gates.map((gate) => {
                    const body = (
                      <>
                        <span className={gate.ok ? styles.met : styles.unmet}>
                          {gate.ok ? <Check size={14} aria-label="Met" /> : <span aria-label="Unmet">●</span>}
                        </span>
                        <span>{GATE_LABELS[gate.key]}</span>
                        <span className={styles.gateDetail}>{gateDetail(data, gate)}</span>
                      </>
                    );
                    return gate.ok ? (
                      <div className={styles.gate} key={gate.key}>
                        {body}
                      </div>
                    ) : (
                      <Link
                        {...rowFocusProps}
                        className={styles.gate}
                        key={gate.key}
                        to={root + GATE_FILTERS[gate.key]}
                      >
                        {body}
                      </Link>
                    );
                  })}
                </RowList>
              </Panel>
              <Panel inset>
                <PanelHeader title="Intent" />
                <div className={styles.cardBody}>
                  {data.project.intentSummary ? (
                    <>
                      <p>{data.project.intentSummary}</p>
                      <p className={styles.meta}>
                        {data.project.intentPath && (
                          <FileLink reference={data.project.intentPath}>{data.project.intentPath}</FileLink>
                        )}
                        {data.project.briefPath && (
                          <FileLink reference={data.project.briefPath}>Original request</FileLink>
                        )}
                        <span>
                          rev {data.project.intentRevision}
                          {data.project.intentUpdatedBy && ` · by ${data.project.intentUpdatedBy}`}
                        </span>
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      icon={LayoutDashboard}
                      text="Intent not recorded yet"
                      action={<Link to={root + "tasks"}>See open tasks</Link>}
                    />
                  )}
                </div>
              </Panel>
              <Numbers data={data} />
              <Coverage swarmId={swarmId} groups={data.criteriaCoverage} />
              <div className={styles.columns}>
                <Panel inset>
                  <PanelHeader title="Worth a look" />
                  <RowList>
                    {data.attention.agreedBlockers.map((criterion) => (
                      <div key={criterion.id} className={styles.attention}>
                        <StatusGlyph status="blocked" />
                        <span>{criterion.title}</span>
                        <Link {...rowFocusProps} to={root + `criteria/${criterion.id}`}>
                          Reject
                        </Link>
                      </div>
                    ))}
                    {data.attention.unreadUserMessages > 0 && (
                      <Link {...rowFocusProps} className={styles.attention} to={root + "agents"}>
                        <MessageSquare size={14} />
                        {data.attention.unreadUserMessages} unread messages to User
                      </Link>
                    )}
                    {data.attention.agreedBlockers.length === 0 && data.attention.unreadUserMessages === 0 && (
                      <EmptyState
                        icon={ListChecks}
                        text="Nothing needs your attention — the swarm is working on its own."
                      />
                    )}
                  </RowList>
                </Panel>
                <Panel inset>
                  <PanelHeader title="Recent activity" />
                  {data.recentActivity.length === 0 ? (
                    <EmptyState icon={LayoutDashboard} text="No activity yet" />
                  ) : (
                    <ol className={styles.activity}>
                      {data.recentActivity.map((entry) => (
                        <AuthoredEntry key={entry.id} author={entry.actor} time={timeAgo(entry.createdAt)}>
                          <p>
                            {activityLabel(entry.kind)}{" "}
                            <IdLink swarmId={swarmId} kind={entry.targetKind} id={entry.targetId} title={entry.title} />{" "}
                            {entry.title}
                          </p>
                        </AuthoredEntry>
                      ))}
                    </ol>
                  )}
                </Panel>
              </div>
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
