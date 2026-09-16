import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoTasks, demoViewer } from "@/lib/demo-data";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) });
  window.sessionStorage.setItem("jarvis-weekend-rest-dismissed", "true");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); });

it("remove valores monetários das tarefas abertas e concluídas do desenvolvedor sem remover os pontos", () => {
  render(<TaskManager initialTasks={demoTasks} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);
  expect(screen.queryByText("Estimado")).not.toBeInTheDocument();
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/pts/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText("Concluídas"));
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Iniciar cronômetro" }).length).toBeGreaterThan(0);
});
