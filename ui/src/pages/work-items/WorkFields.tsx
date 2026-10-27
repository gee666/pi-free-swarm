import { AutoTextarea, CharCounter } from "../../components/Field";
import styles from "./WorkItems.module.css";

export function LongField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <AutoTextarea label={label} value={value} onChange={onChange} />
      <CharCounter text={value} limit={200} />
      {Array.from(value).length > 200 && (
        <p role="status" className={styles.muted}>
          Over 200 characters, the full text is saved to a file
        </p>
      )}
    </div>
  );
}
