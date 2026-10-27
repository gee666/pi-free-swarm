import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SquareKanban } from "lucide-react";
import type { TaskListItem } from "../../../../src/api-types";
import { useSwarmDetail } from "../../api/SwarmView";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RowList, rowFocusProps } from "../../components/RowList";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph } from "../../components/StatusGlyph";
import { PanelLayout } from "../../shell/AppShell";
import { cx } from "../../lib/cx";
import { formatTimestamp } from "../../lib/time";
import { FilterMenu, FilterPill } from "../work-items/FilterMenu";
import { useDebounced, useWorkList } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";

const statuses = [
  ["open", "Open"],
  ["all", "All"],
  ["new", "New"],
  ["claimed", "Claimed"],
  ["in_progress", "In progress"],
  ["review", "In review"],
  ["accepted", "Accepted"],
  ["waiting", "Waiting"],
  ["runnable", "Runnable"],
  ["deferred", "Deferred"],
];

export function TasksPage() {
  const { id: swarmId = "", taskId } = useParams();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const swarm = useSwarmDetail(swarmId);
  const query = useDebounced(search);
  const status = params.get("status") ?? "open";
  const owner = params.get("owner") ?? "";
  const criterion = params.get("criterion");
  const filter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const request = new URLSearchParams({ query });
  if (status === "open") request.set("status", "new,claimed,in_progress,review");
  else if (["waiting", "runnable", "deferred"].includes(status)) request.set(status, "true");
  else if (status !== "all") request.set("status", status);
  if (owner) request.set("owner", owner);
  if (criterion) request.set("criterionId", criterion);
  const list = useWorkList<TaskListItem>(swarmId, "tasks", request.toString());
  const base = `/s/${swarmId}/tasks`;
  const select = (id: number | "new") => navigate(`${base}/${id}?${params}`);
  const owners = [
    { key: "", label: "Anyone" },
    { key: "User", label: "Me" },
    { key: "unowned", label: "Unowned" },
    ...(swarm.data?.participants
      .filter((p) => p.kind === "agent" && p.retiredAt == null)
      .map((p) => ({ key: p.name, label: p.name })) ?? []),
  ];
  return (
    <PanelLayout
      listWidth="clamp(380px, 40%, 560px)"
      list={
        <Panel aria-label="Tasks">
          <PanelHeader
            title="Tasks"
            action={
              <Button size="sm" variant="primary" onClick={() => select("new")}>
                New
              </Button>
            }
          />
          <div className={styles.toolbar}>
            <TextField label="Search tasks" placeholder="Search tasks" value={search} onChange={setSearch} />
            <div className={styles.actions}>
              <FilterMenu
                label="Status"
                items={statuses.map(([key, label]) => ({ key, label, selected: key === status }))}
                onSelect={(value) => filter("status", value)}
              />
              <FilterMenu
                label="Owner"
                items={owners.map((item) => ({ ...item, selected: item.key === owner }))}
                onSelect={(value) => filter("owner", value)}
              />
            </div>
            <div className={styles.chips}>
              {status !== "open" && (
                <FilterPill
                  label={statuses.find(([key]) => key === status)?.[1] ?? status}
                  onRemove={() => filter("status", "")}
                />
              )}
              {owner && <FilterPill label={owner === "User" ? "Me" : owner} onRemove={() => filter("owner", "")} />}
              {criterion && <FilterPill label={`Criterion #${criterion}`} onRemove={() => filter("criterion", "")} />}
            </div>
          </div>
          {list.error && (
            <ErrorBanner action={<Button onClick={list.reload}>Retry</Button>}>{list.error.message}</ErrorBanner>
          )}
          <PanelBody>
            {list.data?.notes.map((note) => (
              <p key={note} className={styles.muted}>
                {note}
              </p>
            ))}
            {!list.data ? (
              !list.error && <SkeletonRows />
            ) : list.data.items.length === 0 ? (
              <EmptyState icon={SquareKanban} text="No tasks" />
            ) : (
              <RowList>
                {list.data.items.map((task) => (
                  <button
                    {...rowFocusProps}
                    key={task.id}
                    className={cx(styles.row, String(task.id) === taskId && styles.selected)}
                    onClick={() => select(task.id)}
                  >
                    <StatusGlyph status={task.status} waiting={task.waiting} />
                    <span className={styles.rowText}>
                      <span className={styles.title}>{task.title}</span>
                      <span className={styles.subtitle}>
                        #{task.id} · {task.owner ?? "Unowned"} ·{" "}
                        {task.waiting
                          ? `waits ${task.waitsOn.map((id) => `#${id}`).join(", ")}`
                          : task.status === "review"
                            ? `in review${task.reviewer ? ` by ${task.reviewer}` : ""}`
                            : task.runnable
                              ? "runnable"
                              : task.status.replace("_", " ")}
                      </span>
                    </span>
                    <span className={styles.muted}>{formatTimestamp(task.updatedAt)}</span>
                  </button>
                ))}
              </RowList>
            )}
            {list.moreError && <ErrorBanner>{list.moreError.message}</ErrorBanner>}
            {list.data?.nextCursor && (
              <Button disabled={list.loadingMore} onClick={list.loadMore}>
                Load more
              </Button>
            )}
          </PanelBody>
        </Panel>
      }
      main={
        taskId === "new" ? (
          <TaskForm
            swarmId={swarmId}
            onCancel={() => navigate(base)}
            onSaved={(id) => {
              list.reload();
              select(id);
            }}
          />
        ) : taskId ? (
          <TaskDetail key={taskId} swarmId={swarmId} id={Number(taskId)} onChanged={list.reload} />
        ) : (
          <Panel>
            <EmptyState icon={SquareKanban} text="Select a task" />
          </Panel>
        )
      }
    />
  );
}
