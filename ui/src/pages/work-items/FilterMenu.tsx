import { useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { Menu, menuOptionId, useMenuNavigation, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Pill } from "../../components/Pill";
import styles from "./WorkItems.module.css";

export function FilterMenu({
  label,
  items,
  onSelect,
  initialOpen = false,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  onSelect: (key: string) => void;
  initialOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const select = (key: string) => {
    onSelect(key);
    close();
  };
  const nav = useMenuNavigation(items, select);
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        icon={ChevronDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? menuOptionId(id, nav.activeIndex) : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          } else if (open) nav.onKeyDown(event);
        }}
      >
        {label}
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={close}>
        <div tabIndex={0} onKeyDown={nav.onKeyDown}>
          <Menu
            id={id}
            label={label}
            items={items}
            activeIndex={nav.activeIndex}
            onActiveIndexChange={nav.setActiveIndex}
            onSelect={select}
            emptyText="No results"
          />
        </div>
      </Popover>
    </>
  );
}

export function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className={styles.line}>
      <Pill>{label}</Pill>
      <IconButton icon={X} label={`Remove ${label}`} onClick={onRemove} />
    </span>
  );
}
