import type { ReactNode } from "react";
import { RecipientChip } from "../RecipientChip";
import { AddAgentButton } from "./AddAgentButton";
import styles from "./Compose.module.css";

interface RecipientFieldProps {
  names: readonly string[];
  /** Every participant that may be addressed. */
  options: readonly string[];
  onChange: (names: string[]) => void;
  /** Thread members: chips without × and no "+ add agent". */
  readOnly: boolean;
  disabled: boolean;
  hint: ReactNode;
}

/** Row 1 of the compose panel: "To:", recipient chips, "+ add agent" and the send hint. */
export function RecipientField({ names, options, onChange, readOnly, disabled, hint }: RecipientFieldProps) {
  const available = options.filter((name) => !names.includes(name));
  return (
    <div className={styles.toRow}>
      <span className={styles.toLabel}>To:</span>
      {names.map((name) => (
        <RecipientChip
          key={name}
          name={name}
          disabled={disabled}
          onRemove={readOnly ? undefined : () => onChange(names.filter((other) => other !== name))}
        />
      ))}
      {!readOnly && (
        <AddAgentButton options={available} disabled={disabled} onAdd={(name) => onChange([...names, name])} />
      )}
      <span className={styles.spacer} />
      {hint}
    </div>
  );
}
