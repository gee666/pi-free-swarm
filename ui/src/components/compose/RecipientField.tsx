import styles from "./Compose.module.css";

export function RecipientField({
  name,
  options,
  onChange,
  disabled,
}: {
  name: string;
  options: readonly string[];
  onChange(name: string): void;
  disabled: boolean;
}) {
  return (
    <label className={styles.toRow}>
      <span className={styles.toLabel}>To:</span>
      <select
        aria-label="Recipient"
        value={name}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select an agent</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
