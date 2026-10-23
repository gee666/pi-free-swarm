import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AgentsPage } from "./pages/agents/AgentsPage";
import { PickerPage } from "./pages/picker/PickerPage";
import { ConfigPage } from "./pages/config/ConfigPage";
import { StatsPage } from "./pages/stats/StatsPage";
import { WallPage } from "./pages/wall/WallPage";
import { WatcherPage } from "./pages/watcher/WatcherPage";
import { WorkPage } from "./pages/work/WorkPage";
import { SwarmLayout } from "./shell/SwarmLayout";
import { SwarmListProvider } from "./api/SwarmList";

export function App() {
  return (
    <BrowserRouter>
      <SwarmListProvider>
        <Routes>
          <Route path="/" element={<PickerPage />} />
          <Route path="/s/:id" element={<SwarmLayout />}>
            <Route index element={<Navigate to="agents" replace />} />
            <Route path="agents/:name?" element={<AgentsPage />} />
            <Route path="wall/:postId?" element={<WallPage />} />
            <Route path="work/:name?" element={<WorkPage />} />
            <Route path="watcher" element={<WatcherPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SwarmListProvider>
    </BrowserRouter>
  );
}
