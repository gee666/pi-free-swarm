import { Users } from "lucide-react";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";

export function AgentsPage() {
  return (
    <PanelLayout
      list={
        <Panel>
          <PanelHeader title="Agents" />
        </Panel>
      }
      main={
        <Panel>
          <EmptyState icon={Users} text="Select a participant to see their mailbox" />
        </Panel>
      }
    />
  );
}
