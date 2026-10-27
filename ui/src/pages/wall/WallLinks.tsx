import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CriterionListItem, PostLinkView, TaskListItem } from "../../../../src/api-types";
import { Button, IconButton } from "../../components/Button";
import { TextField } from "../../components/Field";
import { IdLink } from "../../components/IdLink";
import { Menu, useMenuNavigation } from "../../components/Menu";
import { Pill } from "../../components/Pill";
import { Popover } from "../../components/Popover";
import { StatusGlyph } from "../../components/StatusGlyph";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { useDebounced, useWorkList } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";

export type WallLink = Pick<PostLinkView, "targetId" | "targetKind" | "title"> & { status?: PostLinkView["status"] };
export function WallLinks({
  swarmId,
  links,
  onAdd,
  onRemove,
}: {
  swarmId: string;
  links: WallLink[];
  onAdd: (link: WallLink) => void;
  onRemove: (link: WallLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const query = new URLSearchParams({ query: useDebounced(search) }).toString();
  const tasks = useWorkList<TaskListItem>(swarmId, "tasks", query, open);
  const criteria = useWorkList<CriterionListItem>(swarmId, "criteria", query, open);
  const choices: WallLink[] = [
    ...(tasks.data?.items.map((task): WallLink => ({ targetKind: "task", targetId: task.id, title: task.title, status: task.waiting ? "waiting" : task.status })) ??
      []),
    ...(criteria.data?.items.map((criterion): WallLink => ({
      targetKind: "criterion",
      targetId: criterion.id,
      title: criterion.title,
      status: criterion.status,
    })) ?? []),
  ].filter((item) => !links.some((link) => link.targetKind === item.targetKind && link.targetId === item.targetId));
  const keyFor = (link: WallLink) => `${link.targetKind}:${link.targetId}`;
  const select = (key: string) => {
    const link = choices.find((item) => keyFor(item) === key);
    if (link) {
      onAdd(link);
      setOpen(false);
      setSearch("");
    }
  };
  const items = choices.map((item) => ({
    key: keyFor(item),
    label: `${item.targetKind === "task" ? "Task" : "Criterion"} #${item.targetId} ${item.title}`,
  }));
  const nav = useMenuNavigation(items, select);
  return (
    <div className={styles.line} aria-label="Linked">
      <span className={styles.muted}>Linked</span>
      {links.map((link) => (
        <span className={styles.line} key={keyFor(link)}>
          <Pill>
            <StatusGlyph waiting={link.status === "waiting"} status={link.status && link.status !== "waiting" ? link.status : link.targetKind === "task" ? "new" : "unlinked"} />{" "}
            <IdLink swarmId={swarmId} kind={link.targetKind} id={link.targetId} title={link.title} />
          </Pill>
          <IconButton icon={X} label={`Unlink ${link.targetKind} #${link.targetId}`} onClick={() => onRemove(link)} />
        </span>
      ))}
      <Button ref={anchor} size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        Link…
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)}>
        <div className={styles.form} onKeyDown={nav.onKeyDown}>
          <TextField
            label="Search tasks and criteria"
            placeholder="Search tasks and criteria"
            value={search}
            onChange={setSearch}
          />
          {(tasks.error || criteria.error) && (
            <ErrorBanner
              action={
                <Button
                  onClick={() => {
                    tasks.reload();
                    criteria.reload();
                  }}
                >
                  Retry
                </Button>
              }
            >
              {tasks.error?.message ?? criteria.error?.message}
            </ErrorBanner>
          )}
          {!tasks.data && !criteria.data && !tasks.error && !criteria.error ? (
            <SkeletonRows />
          ) : (
            <Menu
              id={menuId}
              label="Link work"
              items={items}
              activeIndex={nav.activeIndex}
              onActiveIndexChange={nav.setActiveIndex}
              onSelect={select}
              emptyText="No results"
            />
          )}
          {(tasks.data?.nextCursor || criteria.data?.nextCursor) && (
            <Button
              onClick={() => {
                void tasks.loadMore();
                void criteria.loadMore();
              }}
            >
              Load more
            </Button>
          )}
        </div>
      </Popover>
    </div>
  );
}

export function linkRequest(links: WallLink[]) {
  return {
    taskIds: links.filter((link) => link.targetKind === "task").map((link) => link.targetId),
    criterionIds: links.filter((link) => link.targetKind === "criterion").map((link) => link.targetId),
  };
}
