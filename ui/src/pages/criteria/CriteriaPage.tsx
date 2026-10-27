import { Fragment, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { CriteriaGroupsResponse, CriterionListItem } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { UnreadDot } from "../../components/Indicators";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { Pill } from "../../components/Pill";
import { RowList, rowFocusProps } from "../../components/RowList";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph } from "../../components/StatusGlyph";
import { VoteBadge } from "../../components/VoteBadge";
import { PanelLayout } from "../../shell/AppShell";
import { cx } from "../../lib/cx";
import { FilterMenu, FilterPill } from "../work-items/FilterMenu";
import { useDebounced, useWorkList, workUrl } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";
import { CriterionDetail } from "./CriterionDetail";
import { CriterionForm } from "./CriterionForm";

const statuses = [
  ["", "All"],
  ["unlinked", "Unlinked"],
  ["incomplete", "Incomplete"],
  ["satisfied", "Satisfied"],
  ["blocked", "Blocked"],
  ["vote", "Needs my vote"],
];

export function CriteriaPage() {
  const { id: swarmId = "", criterionId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const status = params.get("status") ?? "";
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
      <button
        key={item.id}
        {...rowFocusProps}
        className={cx(styles.row, String(item.id) === criterionId && styles.selected)}
        onClick={() => select(item.id)}
      >
        <StatusGlyph status={item.status} />
        <span className={styles.rowText}>
          <span className={styles.title}>
            {item.title} <UnreadDot unread={item.exceptionPending} />
          </span>
          <span className={styles.subtitle}>
            {query && `${item.group} · `}#{item.id} · {item.linkedTaskCount} tasks ·{" "}
            <VoteBadge {...item.voteProgress} />
          </span>
        </span>
        {item.exceptionPending && (
          <span className={styles.pink}>
            <Pill>Decide</Pill>
          </span>
        )}
      </button>
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
            <div className={styles.actions}>
              <FilterMenu
                label="Status"
                items={statuses.map(([key, label]) => ({ key, label, selected: status === key }))}
                onSelect={(value) => filter("status", value)}
              />
              <FilterMenu
                label="Group"
                items={["", ...(groups.data?.groups ?? [])].map((key) => ({
                  key,
                  label: key || "All",
                  selected: group === key,
                }))}
                onSelect={(value) => filter("group", value)}
              />
              <Button size="sm" aria-pressed={archived} onClick={() => filter("archived", archived ? "" : "true")}>
                Archived
              </Button>
            </div>
            <div className={styles.chips}>
              {status && (
                <FilterPill
                  label={statuses.find(([key]) => key === status)?.[1] ?? status}
                  onRemove={() => filter("status", "")}
                />
              )}
              {group && <FilterPill label={group} onRemove={() => filter("group", "")} />}
              {archived && <FilterPill label="Archived" onRemove={() => filter("archived", "")} />}
            </div>
          </div>
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
                            {records.filter((item) => item.status === "satisfied").length}/{records.length}
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
              <Button onClick={list.loadMore} disabled={list.loadingMore}>
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
            groups={groups.data?.groups ?? []}
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
            groups={groups.data?.groups ?? []}
            onChanged={list.reload}
          />
        ) : (
          <Panel>
            <EmptyState icon={ListChecks} text="Select a criterion" />
          </Panel>
        )
      }
    />
  );
}
