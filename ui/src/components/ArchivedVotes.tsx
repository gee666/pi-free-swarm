import { useEffect, useRef, useState } from "react";
import { fetchAcceptanceHistory } from "../api/acceptance";
import { useAsync } from "../api/useAsync";
import { AgentName } from "./AgentName";
import { Button } from "./Button";
import { ErrorBanner } from "./States";

/** Mounted inside the open popover, never during ordinary swarm snapshots. */
export function ArchivedVotes({ swarmId }: { swarmId: number }) {
  const state = useAsync((signal) => fetchAcceptanceHistory(swarmId, signal), [swarmId]);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<Error>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), [swarmId]);
  const refresh = () => {
    setPageError(undefined);
    state.reload();
  };
  const more = async () => {
    const data = state.data;
    if (!data || data.complete || paging || state.loading) return;
    if (data.next === null) {
      setPageError(new Error("History continuation is unavailable. Close and reopen to refresh."));
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setPaging(true);
    setPageError(undefined);
    try {
      const page = await fetchAcceptanceHistory(swarmId, controller.signal, data.next);
      if (!controller.signal.aborted)
        state.update((current) => {
          if (!current) return current;
          const seen = new Set(current.votes.map((vote) => `${vote.agent}:${vote.run}`));
          return {
            ...page,
            scanned: current.scanned + page.scanned,
            votes: [...current.votes, ...page.votes.filter((vote) => !seen.has(`${vote.agent}:${vote.run}`))],
          };
        });
    } catch (failure) {
      if (!controller.signal.aborted) setPageError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      if (pending.current === controller) pending.current = undefined;
      if (!controller.signal.aborted) setPaging(false);
    }
  };
  return (
    <section aria-label="Archived acceptance history">
      <h3>Archived votes, not counted</h3>
      <p>Retired workers are excluded from current vote counts and the 70% denominator.</p>
      {state.loading && !state.data && <p role="status">Loading archived votes…</p>}
      {state.error && (
        <>
          <ErrorBanner>{`Could not load archived votes: ${state.error.message}`}</ErrorBanner>
          <Button onClick={refresh}>Retry archived history</Button>
        </>
      )}
      {pageError && <ErrorBanner>{`Could not load more archived votes: ${pageError.message}`}</ErrorBanner>}
      {state.data && (
        <>
          {state.data.votes.length === 0 && (
            <p>
              {state.data.complete ? "No archived votes." : "No votes in this bounded scan; more history is available."}
            </p>
          )}
          <ul>
            {state.data.votes.map((vote) => (
              <li key={`${vote.agent}:${vote.run}`}>
                <AgentName name={vote.agent} />: {vote.verdict} · archived · run {vote.run}
                <p>{vote.reason}</p>
              </li>
            ))}
          </ul>
          <p>
            {state.data.complete ? "History complete for this scan." : "More archived history is available."} Scanned{" "}
            {state.data.scanned} retired records.
          </p>
          {!state.data.complete && (
            <Button disabled={paging || state.loading} onClick={() => void more()}>
              {paging ? "Loading older votes…" : "Show more archived votes"}
            </Button>
          )}
          <Button disabled={paging || state.loading} onClick={refresh}>
            Refresh archived history
          </Button>
        </>
      )}
    </section>
  );
}
