import { X } from "lucide-react";
import styles from "./RecipientChip.module.css";
import { Icon } from "./Icon";
import { AgentName } from "./AgentName";

interface RecipientChipProps {
  name: string;
  /** Omit for a read-only chip (thread members). */
  onRemove?: () => void;
  disabled?: boolean;
}

export function RecipientChip({ name, onRemove, disabled = false }: RecipientChipProps) {
  return (
    <span className={styles.chip}>
      <AgentName name={name} />
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${name}`}
        >
          <Icon icon={X} size="status" />
        </button>
      )}
    </span>
  );
}
