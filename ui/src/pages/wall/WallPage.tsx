import { MessageSquare } from "lucide-react";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";

export function WallPage() {
  return (
    <PanelLayout
      list={
        <Panel>
          <PanelHeader title="Wall" />
        </Panel>
      }
      main={
        <Panel>
          <EmptyState icon={MessageSquare} text="No posts yet" />
        </Panel>
      }
    />
  );
}
