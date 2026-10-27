import { useState } from "react";
import { postJson } from "../../api/http";
import { workUrl } from "./useWorkData";

export function useWorkMutation(swarmId: string, onSaved: () => void) {
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const mutate = async (path: string, payload: object) => {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try {
      await postJson<unknown>(workUrl(swarmId, path), payload);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, mutate };
}
