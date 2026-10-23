import { useRef, useState } from "react";
import type { SavedRunConfiguration } from "../../../src/run-configuration";
import { ConfigurationDetails } from "./ConfigurationDetails";
import { Popover } from "./Popover";
import styles from "./AcceptanceSummary.module.css";

export function RunConfiguration({ configuration }: { configuration?: SavedRunConfiguration | null }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchor} className={styles.pill} aria-expanded={open} onClick={() => setOpen(!open)}>
        Run configuration
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="end" className={styles.summary}>
        <ConfigurationDetails configuration={configuration} />
      </Popover>
    </>
  );
}
