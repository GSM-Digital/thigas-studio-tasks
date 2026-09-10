import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoViewer } from "@/lib/demo-data";
import type { TaskView } from "@/lib/types";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("painel do Jarvis", () => {
  it("envia a conversa e inclui a tarefa criada na lista", async () => {
    const createdTask: TaskView = {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Configurar GA4",
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
          status: "open",
          completionSummary: null,
          completionRationale: null,
      complexityLevel: 2,
      basePoints: 10,
          efficiencyAdjustment: 0,
          executionAdjustment: 0,
      points: 10,
      estimatedDurationSeconds: 7200,
      dueAt: "2030-04-18T18:00:00.000Z",
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 0,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      message: "Demanda adicionada.",
      task: createdTask,
    }), { status: 201, headers: { "content-type": "application/json" } }));

    render(
      <TaskManager
        initialTasks={[]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jarvis" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Mensagem para o Jarvis" }), {
      target: { value: "Crie uma demanda de GA4 para amanhã às 15h, estimativa de 2 horas." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    expect(await screen.findByText("Demanda adicionada.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Configurar GA4" })).toBeVisible();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/jarvis/chat",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});
