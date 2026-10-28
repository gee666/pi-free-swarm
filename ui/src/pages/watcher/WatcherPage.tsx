import { Link, useParams } from "react-router-dom";
import { WATCHER_NAME } from "../../../../src/constants";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { useSwarmDetail } from "../agents/useSwarmDetail";
import { activityLabel } from "../work/activity";

export function WatcherPage() {
  const { id = "" } = useParams();
  const detail = useSwarmDetail(id);
  const watcher = detail.data?.participants.find((participant) => participant.name === WATCHER_NAME);
  return (
    <Panel aria-label="Watcher">
      <PanelHeader title="Watcher" />
      <PanelBody>
        {detail.error && <ErrorBanner>{detail.error.message}</ErrorBanner>}
        {!detail.data && !detail.error && <SkeletonRows />}
        {watcher?.kind === "agent" && (
          <p role="status">
            Watcher: {watcher.status} · {activityLabel(watcher)}
          </p>
        )}
        <p>Mention @Watcher in a post or comment to ask it something</p>
        <Link to={`/s/${id}/wall`}>Open the Wall</Link>
      </PanelBody>
    </Panel>
  );
}
