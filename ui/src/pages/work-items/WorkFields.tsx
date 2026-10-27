import { charCount, USER_BODY_PREVIEW_CHARS } from "../../../../src/limits";
import { AutoTextarea, CharCounter } from "../../components/Field";
import styles from "./WorkItems.module.css";

export function LongTextNotice({ value }: { value: string }) {
  return charCount(value) > USER_BODY_PREVIEW_CHARS ? (
    <p role="status" className={styles.muted}>
      Over {USER_BODY_PREVIEW_CHARS} characters, the full text is saved to a file
    </p>
  ) : null;
}

export function LongField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <AutoTextarea label={label} value={value} onChange={onChange} placeholder={placeholder} required={required} />
      <CharCounter text={value} limit={USER_BODY_PREVIEW_CHARS} />
      <LongTextNotice value={value} />
    </div>
  );
}
