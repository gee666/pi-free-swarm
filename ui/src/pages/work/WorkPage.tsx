import { SquareTerminal } from "lucide-react";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState } from "../../components/States";
import { PanelLayout } from "../../shell/AppShell";

export function WorkPage() {
  return (
    <PanelLayout
      list={
        <Panel>
          <PanelHeader title="Work" />
        </Panel>
      }
      main={
        <Panel>
          <EmptyState icon={SquareTerminal} text="Select an agent to see its session" />
        </Panel>
      }
    />
  );
}
