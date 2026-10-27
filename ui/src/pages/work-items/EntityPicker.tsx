import { useId, useRef, useState } from "react";
import type { CriterionListItem, TaskListItem } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Menu, useMenuNavigation } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { useDebounced, useWorkList } from "./useWorkData";
import styles from "./WorkItems.module.css";

export interface EntityChoice {
  id: number;
  title: string;
}
export function EntityPicker({
  swarmId,
  kind,
  label,
  excluded = [],
  onSelect,
}: {
  swarmId: string;
  kind: "task" | "criterion";
  label: string;
  excluded?: number[];
  onSelect: (item: EntityChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const query = useDebounced(search);
  const list = useWorkList<CriterionListItem | TaskListItem>(
    swarmId,
    kind === "task" ? "tasks" : "criteria",
    new URLSearchParams({ query }).toString(),
    open,
  );
  const items = (list.data?.items ?? []).filter((item) => !excluded.includes(item.id));
  const options = items.map((item) => ({ key: String(item.id), label: `#${item.id} ${item.title}` }));
  const select = (key: string) => {
    const item = items.find((item) => String(item.id) === key);
    if (item) {
      onSelect(item);
      setOpen(false);
      setSearch("");
    }
  };
  const nav = useMenuNavigation(options, select);
  return (
    <>
      <Button ref={anchor} size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)}>
        <div className={styles.form} onKeyDown={nav.onKeyDown}>
          <TextField
            autoFocus
            label={`Search ${kind === "task" ? "tasks" : "criteria"}`}
            placeholder={`Search ${kind === "task" ? "tasks" : "criteria"}`}
            value={search}
            onChange={setSearch}
          />
          {list.error && (
            <ErrorBanner action={<Button onClick={list.reload}>Retry</Button>}>{list.error.message}</ErrorBanner>
          )}
          {!list.data && !list.error ? (
            <SkeletonRows />
          ) : (
            <Menu
              id={id}
              label={label}
              items={options}
              activeIndex={nav.activeIndex}
              onActiveIndexChange={nav.setActiveIndex}
              onSelect={select}
              emptyText="No results"
            />
          )}
          {list.data?.nextCursor && (
            <Button disabled={list.loadingMore} onClick={list.loadMore}>
              Load more
            </Button>
          )}
        </div>
      </Popover>
    </>
  );
}
