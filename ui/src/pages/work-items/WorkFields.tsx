import { charCount, USER_BODY_PREVIEW_CHARS } from "../../../../src/limits";
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
      <CharCounter text={value} limit={USER_BODY_PREVIEW_CHARS} />
      {charCount(value) > USER_BODY_PREVIEW_CHARS && (
        <p role="status" className={styles.muted}>
          Over {USER_BODY_PREVIEW_CHARS} characters, the full text is saved to a file
        </p>
      )}
    </div>
  );
}
