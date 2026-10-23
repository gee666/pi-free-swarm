import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AppShell, PanelLayout } from "./AppShell";

it("keeps navigation, both panels and the composer available to responsive layouts", () => {
  render(
    <AppShell topBar={<header>Swarm selector</header>} rail={<nav aria-label="Sections">Agents</nav>}>
      <PanelLayout
        list={<section aria-label="Conversations">Workers</section>}
        main={<section aria-label="Conversation">Messages</section>}
        compose={
          <form aria-label="Send message">
            <button>Send</button>
          </form>
        }
        listWidth="320px"
      />
    </AppShell>,
  );

  expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
  const main = screen.getByRole("main");
  const list = screen.getByRole("region", { name: "Conversations" });
  expect(main).toContainElement(list);
  expect(main).toContainElement(screen.getByRole("region", { name: "Conversation" }));
  expect(main).toContainElement(screen.getByRole("form", { name: "Send message" }));
  // A CSS variable lets narrow-screen rules override the desktop list width.
  expect(list.parentElement?.style.getPropertyValue("--list-width")).toBe("320px");
  expect(list.parentElement?.style.width).toBe("");
});
