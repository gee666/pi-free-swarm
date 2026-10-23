import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FilePreview } from "../../../../src/api-file-types";
import { fetchFilePreview } from "../../api/files";
import { useAsync } from "../../api/useAsync";
import { fileLanguage } from "../../lib/codeLanguages";
import { fileReferencePath } from "../../lib/filePaths";
import { Button, IconButton } from "../Button";
import { CodeBlock, Markdown } from "../Markdown";
import { ErrorBanner } from "../States";
import styles from "./FilePreview.module.css";

const number = new Intl.NumberFormat("en-US");

function ImagePreview({ file, onReload }: { file: Extract<FilePreview, { kind: "image" }>; onReload(): void }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.imageBody} aria-busy={loading}>
      {loading && <p role="status">Loading image…</p>}
      {failed ? (
        <ErrorBanner action={<Button onClick={onReload}>Reload file</Button>}>
          Could not display this image.
        </ErrorBanner>
      ) : (
        <img
          src={file.url}
          alt={file.path}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}

export function FilePreviewDialog({
  swarmId,
  reference,
  onClose,
}: {
  swarmId: string;
  reference: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const path = fileReferencePath(reference);
  const [page, setPage] = useState<{ offset: number; version?: string }>({ offset: 0 });
  const [offsets, setOffsets] = useState([0]);
  const preview = useAsync(
    (signal) => fetchFilePreview(swarmId, path, page.offset, page.version, signal),
    [swarmId, path, page.offset, page.version],
  );
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  const file =
    !preview.loading &&
    !preview.error &&
    preview.data &&
    (preview.data.kind === "image" || preview.data.offset === page.offset)
      ? preview.data
      : undefined;
  const restart = () => {
    setOffsets([0]);
    setPage({ offset: 0 });
    preview.reload();
  };
  const previous = () => {
    if (!file || offsets.length < 2) return;
    const next = offsets.slice(0, -1);
    setOffsets(next);
    setPage({ offset: next[next.length - 1] ?? 0, version: file.version });
  };
  const next = () => {
    if (file?.kind !== "text" || file.nextOffset === null) return;
    const offset = file.nextOffset;
    setOffsets((current) => [...current, offset]);
    setPage({ offset, version: file.version });
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={title}>File preview</h2>
          <p title={reference}>{reference}</p>
        </div>
        <IconButton icon={X} label="Close file preview" onClick={onClose} />
      </header>
      <div className={styles.body} role="region" aria-label="File contents" tabIndex={0} aria-busy={preview.loading}>
        {preview.loading && <p role="status">Loading file…</p>}
        {preview.error && (
          <ErrorBanner action={<Button onClick={restart}>Reload file</Button>}>{preview.error.message}</ErrorBanner>
        )}
        {file?.kind === "image" && <ImagePreview key={file.url} file={file} onReload={restart} />}
        {file?.kind === "text" &&
          (file.totalBytes === 0 ? (
            <p>This file is empty.</p>
          ) : /\.(?:md|markdown)$/i.test(file.path) ? (
            <Markdown source={file.text} highlightCode fileBase={file.path} />
          ) : (
            <CodeBlock language={fileLanguage(file.path)}>{file.text}</CodeBlock>
          ))}
      </div>
      <footer className={styles.footer}>
        <span className={styles.range}>
          {file?.kind === "text" &&
            (file.totalBytes === 0
              ? "0 bytes"
              : `Bytes ${number.format(file.offset + 1)} to ${number.format(file.nextOffset ?? file.totalBytes)} of ${number.format(file.totalBytes)}${file.complete ? " · End of file" : " · More content available"}`)}
          {file?.kind === "image" && `${number.format(file.totalBytes)} bytes · ${file.mimeType}`}
        </span>
        {file?.kind === "text" && (
          <div className={styles.actions}>
            <Button size="sm" onClick={previous} disabled={offsets.length < 2}>
              Previous page
            </Button>
            <Button size="sm" onClick={next} disabled={file.nextOffset === null}>
              Next page
            </Button>
          </div>
        )}
      </footer>
    </dialog>
  );
}
