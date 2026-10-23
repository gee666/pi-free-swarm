import { useEffect, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import type { ParticipantView } from "../../../../src/api-types";
import type { Composer } from "./useComposer";

export function useComposeRequest(
  participants: readonly ParticipantView[] | undefined,
  address: Composer["address"],
  slot: RefObject<HTMLDivElement>,
) {
  const [query, setQuery] = useSearchParams();
  const requested = query.get("compose");
  const recipient = participants?.find(
    (participant) =>
      participant.kind === "agent" &&
      participant.status !== "retired" &&
      participant.name.toLowerCase() === requested?.toLowerCase(),
  )?.name;
  useEffect(() => {
    if (requested === null || participants === undefined) return;
    if (recipient) {
      address([recipient]);
      slot.current?.querySelector("textarea")?.focus();
    }
    setQuery(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("compose");
        return next;
      },
      { replace: true },
    );
  }, [requested, recipient, participants, address, slot, setQuery]);
}
