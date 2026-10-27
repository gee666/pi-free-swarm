import { useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { Menu, useMenuNavigation, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Pill } from "../../components/Pill";
import styles from "./WorkItems.module.css";

export function FilterMenu({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: MenuItem[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const select = (key: string) => {
    onSelect(key);
    setOpen(false);
  };
  const nav = useMenuNavigation(items, select);
  return (
    <>
      <Button ref={anchor} size="sm" icon={ChevronDown} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)}>
        <div tabIndex={0} onKeyDown={nav.onKeyDown}>
          <Menu
            id={id}
            label={label}
            items={items}
            activeIndex={nav.activeIndex}
            onActiveIndexChange={nav.setActiveIndex}
            onSelect={select}
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
