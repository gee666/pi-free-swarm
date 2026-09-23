import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "../shell/TopBar";
import { AgentsReplica } from "./AgentsReplica";
import { ControlsSection } from "./ControlsSection";
import styles from "./Gallery.module.css";
import { PanelsSection } from "./PanelsSection";
import "../styles/index.css";

// Dev-only entry (`npm run dev:ui`, then /gallery.html); the production build contains index.html only.
function GallerySheet() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>
        Component gallery <a href="?replica">Agents replica</a>
      </h1>
      <MemoryRouter>
        <ControlsSection />
        <PanelsSection />
        <TopBar swarms={[]} onSelectSwarm={() => undefined} />
      </MemoryRouter>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("gallery.html has no #root element");

createRoot(root).render(
  <StrictMode>{new URLSearchParams(location.search).has("replica") ? <AgentsReplica /> : <GallerySheet />}</StrictMode>,
);
