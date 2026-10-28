import { Fragment, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { CriteriaGroupsResponse, CriterionListItem } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList } from "../../components/RowList";
import { WorkRow } from "../../components/WorkRow";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph } from "../../components/StatusGlyph";
import { VoteBadge } from "../../components/VoteBadge";
import { PanelLayout } from "../../shell/AppShell";
import { FilterMenu } from "../work-items/FilterMenu";
import { useDebounced } from "../../lib/useDebounced";
import { useWorkList, workUrl } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";
import moreStyles from "../../components/ShowMore.module.css";
import { CriterionDetail } from "./CriterionDetail";
import { CriterionForm } from "./CriterionForm";

const statuses = [
  ["", "All"],
  ["unlinked", "Unlinked"],
  ["incomplete", "Incomplete"],
  ["satisfied", "Satisfied"],
  ["blocked", "Blocked"],
  ["vote", "Needs my vote"],
  ["archived", "Archived"],
];

export function CriteriaPage() {
  const { id: swarmId = "", criterionId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const status = params.get("status") ?? "";
  const selectedStatuses = status.split(",").filter(Boolean);
  const group = params.get("group") ?? "";
  const archived = params.get("archived") === "true";
  const filter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const request = new URLSearchParams({ query });
  if (status === "vote") request.set("needsMyVote", "true");
  else if (status) request.set("status", status);
  if (group) request.set("group", group);
  if (archived) request.set("includeArchived", "true");
  const list = useWorkList<CriterionListItem>(swarmId, "criteria", request.toString());
  const groups = useAsync(
    (signal) =>
      getJson<CriteriaGroupsResponse>(workUrl(swarmId, `criteria/groups?includeArchived=${archived}`), signal),
    [swarmId, archived, list.data],
  );
  const base = `/s/${swarmId}/criteria`;
  const select = (id: number | "new") => navigate(`${base}/${id}?${params}`);
  const items = list.data?.items;
  const grouped = query ? undefined : new Map<string, CriterionListItem[]>();
  if (grouped) for (const item of items ?? []) grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
  const rows = (records: CriterionListItem[]) =>
    records.map((item) => (
      <WorkRow
        key={item.id}
        glyph={<StatusGlyph status={item.status} />}
        title={item.title}
        selected={String(item.id) === criterionId}
        onSelect={() => select(item.id)}
        subtitle={
          <>
            {query && `${item.group} · `}#{item.id} · {item.linkedTaskCount} tasks ·{" "}
            <VoteBadge {...item.voteProgress} />
          </>
        }
      />
    ));
  return (
    <PanelLayout
      listWidth="clamp(380px, 40%, 560px)"
      list={
        <Panel aria-label="Criteria">
          <PanelHeader
            title="Criteria"
            action={
              <Button variant="primary" size="sm" onClick={() => select("new")}>
                New
              </Button>
            }
          />
          <div className={styles.toolbar}>
            <TextField label="Search criteria" placeholder="Search criteria" value={search} onChange={setSearch} />
            <FilterMenu
              label="Status"
              items={statuses.map(([key, label]) => ({
                key,
                label,
                selected:
                  key === "archived"
                    ? archived
                    : !archived && (key ? selectedStatuses.includes(key) : selectedStatuses.length === 0),
              }))}
              onSelect={(value) => {
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.delete("status");
                  next.delete("archived");
                  if (value === "archived") next.set("archived", "true");
                  else if (value) next.set("status", value);
                  return next;
                });
              }}
            />
            <FilterMenu
              label="Group"
              items={["", ...(groups.data?.groups.map((coverage) => coverage.group) ?? [])].map((key) => ({
                key,
                label: key || "All",
                selected: group === key,
              }))}
              onSelect={(value) => filter("group", value)}
            />
          </div>
          {groups.error && (
            <ErrorBanner action={<Button onClick={groups.reload}>Retry</Button>}>{groups.error.message}</ErrorBanner>
          )}
          {list.error && (
            <ErrorBanner action={<Button onClick={list.reload}>Retry</Button>}>{list.error.message}</ErrorBanner>
          )}
          <PanelBody>
            {list.data?.notes.map((note) => (
              <p className={styles.muted} key={note}>
                {note}
              </p>
            ))}
            {!items ? (
              !list.error && <SkeletonRows />
            ) : items.length === 0 ? (
              <EmptyState icon={ListChecks} text="No criteria" />
            ) : (
              <RowList>
                {grouped
                  ? [...grouped].map(([name, records]) => (
                      <Fragment key={name}>
                        <div className={styles.group}>
                          <span>{name}</span>
                          <span>
                            {groups.data?.groups.find((coverage) => coverage.group === name)?.satisfied ??
                              records.filter((item) => item.status === "satisfied").length}
                            /{groups.data?.groups.find((coverage) => coverage.group === name)?.total ?? records.length}
                          </span>
                        </div>
                        {rows(records)}
                      </Fragment>
                    ))
                  : rows(items)}
              </RowList>
            )}
            {list.moreError && <ErrorBanner>{list.moreError.message}</ErrorBanner>}
            {list.data?.nextCursor && (
              <Button className={moreStyles.loadMore} onClick={list.loadMore} disabled={list.loadingMore}>
                Load more
              </Button>
            )}
          </PanelBody>
        </Panel>
      }
      main={
        criterionId === "new" ? (
          <CriterionForm
            swarmId={swarmId}
            groups={groups.data?.groups.map((coverage) => coverage.group) ?? []}
            onCancel={() => navigate(base)}
            onSaved={(id) => {
              list.reload();
              select(id);
            }}
          />
        ) : criterionId ? (
          <CriterionDetail
            key={criterionId}
            swarmId={swarmId}
            id={Number(criterionId)}
            groups={groups.data?.groups.map((coverage) => coverage.group) ?? []}
            onChanged={list.reload}
          />
        ) : (
          <Panel>
            {!list.data && !list.error ? <SkeletonRows /> : <EmptyState icon={ListChecks} text="Select a criterion" />}
          </Panel>
        )
      }
    />
  );
}
