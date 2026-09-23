import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SwarmListItem } from "../../../src/api-types";
import { Icon } from "../components/Icon";
import { Menu, menuOptionId, useMenuNavigation } from "../components/Menu";
import { Popover } from "../components/Popover";
import styles from "./TopBar.module.css";

type SwarmOption = Pick<SwarmListItem, "id" | "name">;

const swarmLabel = (swarm: SwarmOption) => `${swarm.name} · #${swarm.id}`;

interface SwarmSelectProps {
  swarms: readonly SwarmOption[];
  currentId?: number;
  onSelect: (id: number) => void;
}

/** The ~270px swarm dropdown of the top bar. */
export function SwarmSelect({ swarms, currentId, onSelect }: SwarmSelectProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const current = swarms.find((swarm) => swarm.id === currentId);
  const items = swarms.map((swarm) => ({
    key: String(swarm.id),
    label: swarmLabel(swarm),
    selected: swarm.id === currentId,
  }));
  const close = useCallback(() => setOpen(false), []);
  const pick = (key: string) => {
    const swarm = swarms.find((candidate) => String(candidate.id) === key);
    close();
    anchor.current?.focus();
    if (swarm) onSelect(swarm.id);
  };
  const navigation = useMenuNavigation(items, pick);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.select}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && items.length > 0 ? menuOptionId(menuId, navigation.activeIndex) : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={open ? navigation.onKeyDown : undefined}
      >
        <span className={styles.selectLabel}>{current ? swarmLabel(current) : "Select a swarm"}</span>
        <Icon icon={ChevronDown} className={styles.chevron} />
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close}>
        <Menu
          id={menuId}
          label="Swarms"
          items={items}
          activeIndex={navigation.activeIndex}
          onActiveIndexChange={navigation.setActiveIndex}
          onSelect={pick}
          emptyText="No swarms yet"
        />
      </Popover>
    </>
  );
}
