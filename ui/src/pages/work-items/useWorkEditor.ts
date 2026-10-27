import { useState } from "react";
import { getJson } from "../../api/http";
import { workUrl } from "./useWorkData";

export function useWorkEditor<T>(swarmId: string, path: string) {
  const [snapshot, setSnapshot] = useState<T>();
  const [error, setError] = useState<Error>();
  const reload = async () => {
    setError(undefined);
    try {
      setSnapshot(await getJson<T>(workUrl(swarmId, path)));
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    }
  };
  return {
    snapshot,
    edit: (value: T | undefined) => {
      setError(undefined);
      setSnapshot(value);
    },
    reload,
    error,
  };
}
