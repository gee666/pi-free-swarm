import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type RefObject,
} from "react";
import { uploadFile } from "../../api/uploads";

interface UploadOptions {
  swarmId?: string;
  scope?: string;
  text: string;
  onChange: (text: string) => void;
  controls: RefObject<HTMLDivElement>;
  disabled: boolean;
}

export function useComposerUploads({ swarmId, scope, text, onChange, controls, disabled }: UploadOptions) {
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef({ text, onChange, swarmId, scope });
  latest.current = { text, onChange, swarmId, scope };
  const controller = useRef<AbortController>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    setUploading(false);
    setError(undefined);
    return () => {
      controller.current?.abort();
      controller.current = undefined;
    };
  }, [swarmId, scope]);
  useLayoutEffect(() => {
    if (cursor === null) return;
    const textarea = controls.current?.querySelector("textarea");
    textarea?.focus();
    textarea?.setSelectionRange(cursor, cursor);
    setCursor(null);
  }, [text, cursor, controls]);

  const upload = async (files: readonly File[]) => {
    if (!swarmId || disabled || controller.current || files.length === 0) return;
    const operation = new AbortController();
    controller.current = operation;
    setUploading(true);
    setError(undefined);
    const textarea = controls.current?.querySelector("textarea");
    const original = latest.current.text;
    const start = textarea?.selectionStart ?? original.length;
    const end = textarea?.selectionEnd ?? start;
    const paths: string[] = [];
    try {
      for (const file of files) {
        const result = await uploadFile(swarmId, file, operation.signal);
        paths.push(result.path);
      }
    } catch (failure) {
      if (!operation.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!operation.signal.aborted && latest.current.swarmId === swarmId && latest.current.scope === scope) {
        if (paths.length > 0) {
          const current = latest.current;
          const unchanged = current.text === original;
          const before = current.text.slice(0, unchanged ? start : current.text.length);
          const after = unchanged ? current.text.slice(end) : "";
          const inserted = `${before && !before.endsWith("\n") ? "\n" : ""}${paths.join("\n")}${after && !after.startsWith("\n") ? "\n" : ""}`;
          current.onChange(before + inserted + after);
          setCursor(before.length + inserted.length);
        }
        setUploading(false);
      }
      if (controller.current === operation) controller.current = undefined;
    }
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void upload(files);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!swarmId || disabled || uploading) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void upload(files);
  };
  return { picker, onFileChange, onPaste, uploading, error };
}
