import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoViewer } from "@/lib/demo-data";
import { deadlineInputToIso, formatDeadline } from "@/lib/domain/deadline";
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

  constructor() { MockSpeechRecognition.instance = this; }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
  emit(transcript: string, isFinal = true) {
    this.onresult?.({ results: [Object.assign([{ transcript }], { 0: { transcript }, isFinal })] });
  }
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  window.SpeechRecognition = MockSpeechRecognition as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete window.SpeechRecognition;
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
    expect(screen.getByRole("button", { name: "Salvar descrição" })).toHaveClass("inline-edit-action", "confirm");
    expect(screen.getByRole("button", { name: "Cancelar edição da descrição" })).toHaveClass("inline-edit-action", "cancel");
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
      completionSummary: null,
      completionRationale: null,
      basePoints: 1,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
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

  it("reordena imediatamente quando o prazo é editado", async () => {
    const base: Omit<TaskView, "id" | "title" | "dueAt"> = {
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "open",
      completionSummary: null,
      completionRationale: null,
      complexityLevel: 2,
      basePoints: 8,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 8,
      estimatedDurationSeconds: 3600,
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 0,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(
      <TaskManager
        initialTasks={[
          { ...base, id: "first", title: "Primeira demanda", dueAt: "2030-04-20T18:00:00.000Z" },
          { ...base, id: "second", title: "Segunda demanda", dueAt: "2030-04-21T18:00:00.000Z" },
        ]}
        clients={demoClients}
        viewer={demoViewer}
        initialSettings={demoSettings}
        demoMode
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Primeira demanda",
      "Segunda demanda",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Editar prazo de Segunda demanda" }));
    fireEvent.change(screen.getByLabelText("Novo prazo de Segunda demanda"), {
      target: { value: "2030-04-18T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazo" }));

    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Segunda demanda",
      "Primeira demanda",
    ]));
  });

  it("troca o cliente da demanda diretamente no card", async () => {
    const task: TaskView = {
      id: "task-client",
      title: "Trocar cliente",
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "open",
      completionSummary: null,
      completionRationale: null,
      complexityLevel: 1,
      basePoints: 2,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 2,
      estimatedDurationSeconds: 1800,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 0,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };
    render(<TaskManager initialTasks={[task]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);

    fireEvent.click(screen.getByRole("button", { name: "Editar cliente de Trocar cliente" }));
    expect(screen.getByRole("button", { name: "Salvar cliente" })).toHaveClass("inline-edit-action", "confirm");
    expect(screen.getByRole("button", { name: "Cancelar edição do cliente" })).toHaveClass("inline-edit-action", "cancel");
    fireEvent.change(screen.getByRole("combobox", { name: "Novo cliente de Trocar cliente" }), {
      target: { value: demoClients[1]!.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));

    expect(await screen.findByRole("button", { name: "Editar cliente de Trocar cliente" })).toHaveTextContent(demoClients[1]!.name);
  });
});

describe("favicon do cronômetro", () => {
  it("fica vermelho somente enquanto existe uma tarefa rodando", async () => {
    const runningTask: TaskView = {
      id: "running-task",
      title: "Tarefa em andamento",
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "in_progress",
      completionSummary: null,
      completionRationale: null,
      complexityLevel: 2,
      basePoints: 8,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 8,
      estimatedDurationSeconds: 3600,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: null,
      activeTimerStartedAt: new Date().toISOString(),
      trackedSeconds: 0,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(<TaskManager initialTasks={[runningTask]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);

    await waitFor(() => expect(document.querySelector<HTMLLinkElement>("#task-status-favicon")?.href).toContain("data:image/svg+xml"));
    expect(decodeURIComponent(document.querySelector<HTMLLinkElement>("#task-status-favicon")!.href)).toContain("#FF3B30");

    fireEvent.click(screen.getByRole("button", { name: "Parar cronômetro" }));
    await waitFor(() => expect(document.querySelector<HTMLLinkElement>("#task-status-favicon")?.getAttribute("href")).toBe("/icon.svg"));
  });
});

describe("fechamento assistido pelo Jarvis", () => {
  it("exibe uma penalidade de execução no card concluído", () => {
    const task: TaskView = {
      id: "penalized-task",
      title: "Implementar página institucional",
      description: null,
      completionSummary: "A página ficou incompleta e precisa de retrabalho antes da publicação.",
      completionRationale: "A entrega está incompleta e exige retrabalho relevante.",
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "completed",
      complexityLevel: 3,
      basePoints: 25,
      efficiencyAdjustment: 0,
      executionAdjustment: -10,
      points: 15,
      estimatedDurationSeconds: 14_400,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: "2030-04-18T12:00:00.000Z",
      activeTimerStartedAt: null,
      trackedSeconds: 14_400,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(<TaskManager initialTasks={[task]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);

    expect(screen.getByText("-10 execução")).toHaveClass("negative");
    expect(screen.getByText("15 pts")).toBeVisible();
  });

  it("exige um relato antes de concluir e exibe o registro na tarefa", async () => {
    const task: TaskView = {
      id: "task-to-complete",
      title: "Corrigir integração do formulário",
      description: "Validar também o envio ao CRM.",
      completionSummary: null,
      completionRationale: null,
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "open",
      complexityLevel: 2,
      basePoints: 10,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 10,
      estimatedDurationSeconds: 7200,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 5400,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(<TaskManager initialTasks={[task]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);

    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    expect(screen.getByRole("dialog", { name: "Como foi a execução?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Resumir e concluir" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Concluir tarefa" })).toBeVisible();

    const summary = "Havia um conflito no script externo; corrigi a ordem de carregamento e validei os leads no CRM.";
    fireEvent.change(screen.getByLabelText("Conte livremente como foi a entrega"), { target: { value: summary } });
    fireEvent.click(screen.getByRole("button", { name: "Resumir e concluir" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Como foi a execução?" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reabrir tarefa" })).toBeVisible();
    expect(screen.getByText(summary)).toBeVisible();
    expect(screen.getByText(/Jarvis: A execução seguiu o escopo esperado/)).toBeVisible();
  });

  it("transcreve o relato de entrega pelo microfone antes de o Jarvis resumir", async () => {
    const task: TaskView = {
      id: "task-voice-completion",
      title: "Publicar landing page",
      description: "Publicar e validar o formulário.",
      completionSummary: null,
      completionRationale: null,
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "open",
      complexityLevel: 3,
      basePoints: 25,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 25,
      estimatedDurationSeconds: 10_800,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: null,
      activeTimerStartedAt: null,
      trackedSeconds: 7_200,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(<TaskManager initialTasks={[task]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} demoMode />);

    fireEvent.click(screen.getByRole("button", { name: "Concluir tarefa" }));
    const microphone = screen.getByRole("button", { name: "Ditar relato da entrega" });
    expect(microphone).toBeEnabled();
    fireEvent.click(microphone);
    expect(screen.getByRole("button", { name: "Parar ditado da entrega" })).toHaveAttribute("aria-pressed", "true");

    const spoken = "Eu publiquei a landing page, corrigi o carregamento do formulário e validei o envio dos leads no CRM.";
    act(() => MockSpeechRecognition.instance?.emit(spoken));
    expect(screen.getByRole("textbox", { name: "Conte livremente como foi a entrega" })).toHaveValue(spoken);
    expect(screen.getByRole("button", { name: "Resumir e concluir" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Parar ditado da entrega" }));
    expect(screen.getByRole("button", { name: "Resumir e concluir" })).toBeEnabled();
  });

  it("permite reavaliar uma conclusão quando a avaliação anterior falhou", async () => {
    const failedTask: TaskView = {
      id: "failed-evaluation",
      title: "Implementar formulário LP",
      description: null,
      completionSummary: "Implementei o formulário e validei o envio dos dados no ambiente final.",
      completionRationale: null,
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "completed",
      complexityLevel: 2,
      basePoints: 10,
      efficiencyAdjustment: 3,
      executionAdjustment: 0,
      points: 13,
      estimatedDurationSeconds: 5400,
      dueAt: "2030-04-20T18:00:00.000Z",
      completedAt: "2030-04-18T14:30:00.000Z",
      activeTimerStartedAt: null,
      trackedSeconds: 1721,
      manualDurationSeconds: null,
      classificationStatus: "failed",
      classificationError: {
        referenceId: "JRV-AB12CD34",
        provider: "Gemini",
        category: "quota_exhausted",
        status: 429,
        code: "RESOURCE_EXHAUSTED",
        title: "Cota ou créditos da API esgotados",
        message: "O Gemini informou que a cota disponível foi consumida.",
        technicalDetail: "ApiError: Daily quota exceeded",
        occurredAt: "2026-09-10T19:30:00.000Z",
      },
    };
    const evaluatedTask: TaskView = {
      ...failedTask,
      classificationStatus: "classified",
      classificationError: null,
      completionRationale: "A entrega foi concluída e validada, sem evidência de esforço adicional.",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ task: evaluatedTask }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    render(<TaskManager initialTasks={[failedTask]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} />);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    expect(screen.getAllByText("Cota ou créditos da API esgotados")).not.toHaveLength(0);
    expect(screen.getByText(/HTTP 429 · RESOURCE_EXHAUSTED · JRV-AB12CD34/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copiar diagnóstico do Jarvis" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Referência: JRV-AB12CD34")));

    fireEvent.click(screen.getByRole("button", { name: "Reavaliar com Jarvis" }));

    expect(screen.getByRole("button", { name: "Reavaliando..." })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/Jarvis: A entrega foi concluída e validada/)).toBeVisible());
    expect(screen.queryByRole("button", { name: "Reavaliar com Jarvis" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/failed-evaluation/reevaluate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("exibe o diagnóstico devolvido pela API quando a reavaliação falha", async () => {
    const failedTask: TaskView = {
      id: "failed-without-diagnostic",
      title: "Configurar eventos do GA4",
      description: null,
      completionSummary: "Configurei os eventos e validei o envio no ambiente final.",
      completionRationale: null,
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "completed",
      complexityLevel: 2,
      basePoints: 10,
      efficiencyAdjustment: 0,
      executionAdjustment: 0,
      points: 10,
      estimatedDurationSeconds: 5400,
      dueAt: null,
      completedAt: "2030-04-18T14:30:00.000Z",
      activeTimerStartedAt: null,
      trackedSeconds: 5400,
      manualDurationSeconds: null,
      classificationStatus: "failed",
      classificationError: null,
    };
    const diagnostic = {
      referenceId: "JRV-EF56GH78",
      provider: "Gemini",
      category: "quota_exhausted",
      status: 429,
      code: "RESOURCE_EXHAUSTED",
      title: "Cota ou créditos da API esgotados",
      message: "O Gemini informou que a cota disponível foi consumida.",
      technicalDetail: "ApiError: Daily quota exceeded",
      occurredAt: "2026-09-10T19:30:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { code: diagnostic.code, message: diagnostic.message, details: { diagnostic } },
    }), { status: 429, headers: { "content-type": "application/json" } }));

    render(<TaskManager initialTasks={[failedTask]} clients={demoClients} viewer={demoViewer} initialSettings={demoSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "Reavaliar com Jarvis" }));

    expect(await screen.findByText(/HTTP 429 · RESOURCE_EXHAUSTED · JRV-EF56GH78/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Copiar diagnóstico do Jarvis" })).toBeVisible();
  });
});

describe("detalhamento da pontuação na visão Agência", () => {
  it("explica pontos-base, bônus e justificativa de cada entrega", () => {
    const completedTask: TaskView = {
      id: "agency-detailed-task",
      title: "Migrar landing page institucional",
      description: "Migrar a página e preservar o formulário.",
      completionSummary: "Migrei a landing page, corrigi a integração externa e validei os leads no ambiente final.",
      completionRationale: "O desenvolvedor resolveu uma incompatibilidade externa relevante e evitou a perda de leads.",
      clientId: demoClients[0]!.id,
      clientName: demoClients[0]!.name,
      clientColor: demoClients[0]!.color,
      status: "completed",
      complexityLevel: 3,
      basePoints: 25,
      efficiencyAdjustment: 10,
      executionAdjustment: 3,
      points: 38,
      estimatedDurationSeconds: 14_400,
      dueAt: null,
      completedAt: new Date().toISOString(),
      activeTimerStartedAt: null,
      trackedSeconds: 5_400,
      manualDurationSeconds: null,
      classificationStatus: "classified",
    };

    render(
      <TaskManager
        initialTasks={[completedTask]}
        clients={demoClients}
        viewer={{ ...demoViewer, role: "agency" }}
        initialSettings={demoSettings}
        demoMode
      />,
    );

    const detailButton = screen.getByRole("button", { name: "Ver detalhes de Migrar landing page institucional" });
    expect(detailButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailButton);

    expect(screen.getByRole("button", { name: "Ocultar detalhes de Migrar landing page institucional" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Nível 3")).toBeVisible();
    expect(screen.getByText("25 pontos-base atribuídos pelo Jarvis.")).toBeVisible();
    expect(screen.getByText("+10 pontos")).toBeVisible();
    expect(screen.getByText("+3 pontos")).toBeVisible();
    expect(screen.getByText("25 + 10 + 3 = 38")).toBeVisible();
    expect(screen.getByText(/resolveu uma incompatibilidade externa relevante/)).toBeVisible();
    expect(screen.getByText(completedTask.completionSummary!)).toBeVisible();
  });
});
