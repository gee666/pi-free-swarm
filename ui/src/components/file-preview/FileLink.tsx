import { useContext, type ReactNode } from "react";
import { FilePreviewContext } from "./context";
import { hasInvalidUnicode } from "../../lib/filePaths";
import styles from "./FilePreview.module.css";

export function FileLink({ reference, children }: { reference: string; children: ReactNode }) {
  const open = useContext(FilePreviewContext);
  if (!open || hasInvalidUnicode(reference)) return <>{children}</>;
  return (
    <a
      href={`#file=${encodeURIComponent(reference)}`}
      className={styles.fileLink}
      title={`Preview ${reference}`}
      onClick={(event) => {
        event.preventDefault();
        open(reference);
      }}
    >
      {children}
    </a>
  );
}
