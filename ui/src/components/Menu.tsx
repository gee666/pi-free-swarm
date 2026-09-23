import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import styles from "./Menu.module.css";

export interface MenuItem {
  key: string;
  label: ReactNode;
  /** Shows the pink checkmark. */
  selected?: boolean;
}

/** Keyboard state for a Menu driven from whichever element holds focus (list or search input). */
export function useMenuNavigation(items: readonly MenuItem[], onSelect: (key: string) => void) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = Math.min(activeIndex, items.length - 1);
  const onKeyDown = (event: KeyboardEvent) => {
    if (items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelect(items[active].key);
    }
  };
  return { activeIndex: active, setActiveIndex, onKeyDown };
}

export const menuOptionId = (menuId: string, index: number) => `${menuId}-option-${index}`;

interface MenuProps {
  /** DOM id, referenced by aria-activedescendant of the focused element. */
  id: string;
  label: string;
  items: readonly MenuItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (key: string) => void;
  emptyText?: string;
}

/** 40px option rows for popovers. */
export function Menu({ id, label, items, activeIndex, onActiveIndexChange, onSelect, emptyText }: MenuProps) {
  if (items.length === 0) return emptyText ? <p className={styles.empty}>{emptyText}</p> : null;
  return (
    <ul id={id} role="listbox" aria-label={label} className={styles.menu}>
      {items.map((item, index) => (
        <li
          key={item.key}
          id={menuOptionId(id, index)}
          role="option"
          aria-selected={item.selected ?? false}
          className={cx(styles.option, index === activeIndex && styles.active)}
          // Keeps focus in the search input or list while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onSelect(item.key)}
        >
          <span className={styles.label}>{item.label}</span>
          {item.selected && <Icon icon={Check} className={styles.check} />}
        </li>
      ))}
    </ul>
  );
}
