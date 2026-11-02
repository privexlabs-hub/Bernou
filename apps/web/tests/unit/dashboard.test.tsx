import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BernouDB, __setDbForTests } from "@/db/dexie";
import { createSession } from "@/db/repositories/sessions";
import { Dashboard } from "@/features/dashboard/Dashboard";

beforeEach(async () => {
  const fresh = new BernouDB(`test-${Math.random()}`);
  __setDbForTests(fresh);
  await fresh.open();
  // jsdom lacks these
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/studio/:sessionId" element={<div data-testid="studio-route">studio</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  it("shows empty states when nothing exists", async () => {
    renderDashboard();
    expect(await screen.findByText("No presentations yet.")).toBeInTheDocument();
  });

  it("creates a new session and navigates to the studio (AC1)", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(await screen.findByTestId("new-presentation"));
    expect(await screen.findByTestId("studio-route")).toBeInTheDocument();
  });

  it("lists recent sessions, most recent first", async () => {
    await createSession("Older");
    await new Promise((r) => setTimeout(r, 3));
    await createSession("Newer");
    renderDashboard();
    await waitFor(() => expect(screen.getAllByTestId("session-title")).toHaveLength(2));
    const titles = screen.getAllByTestId("session-title").map((el) => el.textContent);
    expect(titles).toEqual(["Newer", "Older"]);
  });

  it("deletes a session after confirmation", async () => {
    const user = userEvent.setup();
    await createSession("Doomed");
    renderDashboard();
    await screen.findByText("Doomed");
    await user.click(screen.getByTestId("session-menu"));
    await user.click(await screen.findByTestId("session-delete"));
    await user.click(await screen.findByTestId("session-delete-confirm"));
    await waitFor(() => expect(screen.queryByText("Doomed")).not.toBeInTheDocument());
    expect(await screen.findByText("No presentations yet.")).toBeInTheDocument();
  });
});
