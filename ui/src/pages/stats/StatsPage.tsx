import { ChartColumn } from "lucide-react";
import { Panel, PanelHeader } from "../../components/Panel";
import { EmptyState } from "../../components/States";

export function StatsPage() {
  return (
    <Panel>
      <PanelHeader title="Stats" />
      <EmptyState icon={ChartColumn} text="No stats yet" />
    </Panel>
  );
}
