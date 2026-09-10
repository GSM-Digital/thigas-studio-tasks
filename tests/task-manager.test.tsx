import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoViewer } from "@/lib/demo-data";
import { deadlineInputToIso, formatDeadline } from "@/lib/domain/deadline";
import type { TaskView } from "@/lib/types";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    fireEvent.change(screen.getByRole("textbox", { name: "Descrição da nova tarefa" }), {
      target: { value: "Revisar o formulário e documentar o resultado." },
    });
    fireEvent.change(screen.getByLabelText("Data e hora do prazo"), {
      target: { value: dueAtInput },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByRole("heading", { name: "Validar prazo personalizado" })).toBeVisible();
    expect(screen.getByText("Revisar o formulário e documentar o resultado.")).toBeVisible();
    expect(screen.getByText(`Prazo ${formatDeadline(deadlineInputToIso(dueAtInput))}`)).toBeVisible();

    fireEvent.click(screen.getByText("Revisar o formulário e documentar o resultado."));
    fireEvent.change(screen.getByRole("textbox", { name: "Descrição de Validar prazo personalizado" }), {
      target: { value: "Observação atualizada." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar descrição" }));
    expect(screen.getByText("Observação atualizada.")).toBeVisible();
  });

  it("envia o SLA vazio para o Jarvis estimar automaticamente", async () => {
    const dueAtInput = "2030-04-18T14:30";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      task: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Configurar eventos do GA4",
        clientId: demoClients[0]!.id,
        clientName: demoClients[0]!.name,
        clientColor: demoClients[0]!.color,
        status: "open",
        complexityLevel: 2,
        basePoints: 10,
        efficiencyAdjustment: 0,
        points: 10,
        estimatedDurationSeconds: 5400,
        dueAt: deadlineInputToIso(dueAtInput),
        completedAt: null,
        activeTimerStartedAt: null,
        trackedSeconds: 0,
        manualDurationSeconds: null,
        classificationStatus: "classified",
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));

    render(
      <TaskManager
        initialTasks={[]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
      />,
    );

    expect(screen.getByLabelText("Prazo estimado em horas")).toHaveValue(null);
    fireEvent.change(screen.getByRole("textbox", { name: "Título da nova tarefa" }), {
      target: { value: "Configurar eventos do GA4" },
    });
    fireEvent.change(screen.getByLabelText("Data e hora do prazo"), {
      target: { value: dueAtInput },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByRole("heading", { name: "Configurar eventos do GA4" })).toBeVisible();
    expect(screen.getByText("Jarvis estimou o SLA em 01:30:00.")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      title: "Configurar eventos do GA4",
      estimatedDurationSeconds: null,
    });
  });
});

describe("ordenação das demandas", () => {
  it("exibe primeiro a tarefa que precisa começar antes", () => {
    const dueAt = "2030-04-18T18:00:00.000Z";
    const base: Omit<TaskView, "id" | "title" | "complexityLevel" | "estimatedDurationSeconds"> = {
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "open",
      basePoints: 1,
      efficiencyAdjustment: 0,
      points: 1,
      dueAt,
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 0,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(
      <TaskManager
        initialTasks={[
          { ...base, id: "short", title: "Tarefa curta", complexityLevel: 1, estimatedDurationSeconds: 1800 },
          { ...base, id: "long", title: "Tarefa longa e complexa", complexityLevel: 4, estimatedDurationSeconds: 28_800 },
        ]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
        demoMode
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Tarefa longa e complexa",
      "Tarefa curta",
    ]);
  });
});
