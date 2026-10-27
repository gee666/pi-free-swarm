import { useCallback, useEffect, useRef, useState } from "react";
import type { SwarmListItem } from "../../../../src/api-types";
import { sendMessage } from "../../api/agents";
import { ApiError } from "../../api/http";

export function useComposer(swarmId: string, swarm: SwarmListItem | undefined, defaultTo: string) {
  const revision = useRef(0);
  const [text, setText] = useState("");
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejectedFor, setRejectedFor] = useState<SwarmListItem>();
  const address = useCallback((name: string) => {
    revision.current += 1;
    setTo(name);
  }, []);
  useEffect(() => address(defaultTo), [swarmId, defaultTo, address]);
  const send = () => {
    if (!to || busy) return;
    const submittedRevision = revision.current;
    setBusy(true);
    setError(undefined);
    sendMessage(swarmId, { to, text })
      .then(
        () => {
          if (revision.current === submittedRevision) setText("");
        },
        (failure: Error) => {
          if (failure instanceof ApiError && failure.code === "swarm_not_running") setRejectedFor(swarm);
          else if (revision.current === submittedRevision) setError(failure.message);
        },
      )
      .finally(() => setBusy(false));
  };
  return {
    text,
    to,
    address,
    setTo: address,
    send,
    busy,
    error,
    setText: (next: string) => {
      revision.current += 1;
      setText(next);
      setError(undefined);
    },
    disabled: swarm !== undefined && (!swarm.acceptsMessages || rejectedFor === swarm),
  };
}
export type Composer = ReturnType<typeof useComposer>;
