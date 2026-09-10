import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoViewer } from "@/lib/demo-data";
import type { TaskView } from "@/lib/types";

class MockSpeechRecognition {
  static instance: MockSpeechRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: { results: Array<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor() {
    MockSpeechRecognition.instance = this;
  }

  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
  emit(transcript: string, isFinal = true) {
    this.onresult?.({ results: [Object.assign([{ transcript }], { 0: { transcript }, isFinal })] });
  }
  emitError(error: string) { this.onerror?.({ error }); }
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.SpeechRecognition = MockSpeechRecognition as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
afterAll(() => {
  delete window.SpeechRecognition;
});

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

  it("transcreve uma demanda ditada em português antes do envio", async () => {
    render(
      <TaskManager
        initialTasks={[]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jarvis" }));
    const microphone = await screen.findByRole("button", { name: "Ditar demanda" });
    await waitFor(() => expect(microphone).toBeEnabled());
    fireEvent.click(microphone);

    expect(screen.getByRole("button", { name: "Parar ditado" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Ouvindo/)).toBeVisible();
    act(() => MockSpeechRecognition.instance?.emit("Jarvis, crie uma demanda para o cliente Full Body amanhã às quinze horas."));

    expect(screen.getByRole("textbox", { name: "Mensagem para o Jarvis" })).toHaveValue(
      "Jarvis, crie uma demanda para o cliente Full Body amanhã às quinze horas.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Parar ditado" }));
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
  });

  it("orienta o usuário quando o acesso ao microfone é recusado", async () => {
    render(
      <TaskManager
        initialTasks={[]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jarvis" }));
    const microphone = await screen.findByRole("button", { name: "Ditar demanda" });
    await waitFor(() => expect(microphone).toBeEnabled());
    fireEvent.click(microphone);
    act(() => MockSpeechRecognition.instance?.emitError("not-allowed"));

    expect(screen.getByRole("alert")).toHaveTextContent("Permita o acesso ao microfone para usar o ditado.");
    expect(screen.getByRole("button", { name: "Ditar demanda" })).toBeEnabled();
  });
});
