import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoViewer } from "@/lib/demo-data";
import { deadlineInputToIso, formatDeadline } from "@/lib/domain/deadline";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

describe("formulário de nova demanda", () => {
  it("cria uma tarefa com a data e hora escolhidas", async () => {
    const dueAtInput = "2030-04-18T14:30";
    render(
      <TaskManager
        initialTasks={[]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
        demoMode
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Título da nova tarefa" }), {
      target: { value: "Validar prazo personalizado" },
    });
    fireEvent.change(screen.getByLabelText("Data e hora do prazo"), {
      target: { value: dueAtInput },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByRole("heading", { name: "Validar prazo personalizado" })).toBeVisible();
    expect(screen.getByText(`Prazo ${formatDeadline(deadlineInputToIso(dueAtInput))}`)).toBeVisible();
  });
});
