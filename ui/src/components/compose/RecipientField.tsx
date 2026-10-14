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
}

export function RecipientField({ names, options, onChange, readOnly, disabled }: RecipientFieldProps) {
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
    </div>
  );
}
