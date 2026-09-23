import { useCallback, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../Button";
import { Menu, menuOptionId, useMenuNavigation } from "../Menu";
import { Popover } from "../Popover";
import styles from "./Compose.module.css";

interface AddAgentButtonProps {
  /** Participants not yet in "To". */
  options: readonly string[];
  onAdd: (name: string) => void;
  disabled?: boolean;
}

/** "+ add agent" with an autocomplete popover of the swarm's participants. */
export function AddAgentButton({ options, onAdd, disabled = false }: AddAgentButtonProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const items = options
    .filter((name) => name.toLowerCase().includes(needle))
    .map((name) => ({ key: name, label: name }));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  const pick = (name: string) => {
    onAdd(name);
    close();
    anchor.current?.focus();
  };
  const navigation = useMenuNavigation(items, pick);

  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        icon={Plus}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        add agent
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={close} className={styles.agentPopover}>
        <input
          className={styles.search}
          value={query}
          placeholder="Find an agent…"
          aria-label="Find an agent"
          role="combobox"
          aria-controls={menuId}
          aria-expanded="true"
          aria-activedescendant={items.length > 0 ? menuOptionId(menuId, navigation.activeIndex) : undefined}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            navigation.setActiveIndex(0);
          }}
          onKeyDown={navigation.onKeyDown}
        />
        <Menu
          id={menuId}
          label="Agents"
          items={items}
          activeIndex={navigation.activeIndex}
          onActiveIndexChange={navigation.setActiveIndex}
          onSelect={pick}
          emptyText="No matching agents"
        />
      </Popover>
    </>
  );
}
