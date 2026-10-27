import type { SearchConfigResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { Button } from "../../components/Button";
import { Section } from "../../components/Section";
import { ErrorBanner, SkeletonRows } from "../../components/States";

export function SearchConfig({ swarmId }: { swarmId: string }) {
  const state = useAsync(
    (signal) => getJson<SearchConfigResponse>(`/api/swarms/${encodeURIComponent(swarmId)}/search-config`, signal),
    [swarmId],
  );
  return (
    <Section title="Search">
      {state.error && (
        <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
      )}
      {!state.data ? (
        !state.error && <SkeletonRows count={4} />
      ) : (
        <>
          <p>Ranking: BM25</p>
          <p>Embeddings: {state.data.embedding}</p>
          <p>Reranker: {state.data.reranker}</p>
          <p>Max results per page: {state.data.maxResults}</p>
        </>
      )}
    </Section>
  );
}
