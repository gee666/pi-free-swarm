import { useCallback, useRef, useState, type ReactNode } from "react";
import { FilePreviewContext } from "./context";
import { FilePreviewDialog } from "./FilePreviewDialog";

export function FilePreviewProvider({ swarmId, children }: { swarmId: string; children: ReactNode }) {
  const [selection, setSelection] = useState<{ id: number; reference: string } | null>(null);
  const generation = useRef(0);
  const open = useCallback((reference: string) => setSelection({ id: ++generation.current, reference }), []);
  return (
    <FilePreviewContext.Provider value={open}>
      {children}
      {selection !== null && (
        <FilePreviewDialog
          key={selection.id}
          swarmId={swarmId}
          reference={selection.reference}
          onClose={() => setSelection((current) => (current?.id === selection.id ? null : current))}
        />
      )}
    </FilePreviewContext.Provider>
  );
}
