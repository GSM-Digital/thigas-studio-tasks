import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskManager } from "@/components/task-manager";
import { demoClients, demoSettings, demoTasks, demoViewer } from "@/lib/demo-data";

const delivered = (id: string, title: string, completedAt: string, points: number) => ({
  ...demoTasks[0]!, id, title, completedAt, points, status: "completed" as const,
  trackedSeconds: 60, activeTimerStartedAt: null,
});
const tasks = [
  delivered("now", "Entrega atual", "2026-09-15T03:00:00Z", 10),
  delivered("old", "Entrega anterior", "2026-09-15T02:59:59Z", 20),
  delivered("older", "Entrega de julho", "2026-07-20T12:00:00Z", 5),
];
function renderAgency(demoMode = true) {
  render(<TaskManager initialTasks={demoMode ? tasks : []} clients={demoClients} viewer={{ ...demoViewer, role: "agency" }} initialSettings={demoSettings} demoMode={demoMode} />);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("histórico de faturamento da agência", () => {
  it("abre no atual, compara com anterior e permite navegar sem misturar entregas", () => {
    renderAgency();
    expect(screen.getByLabelText("Mês do faturamento")).toHaveValue("2026-09");
    expect(screen.getByText("Entrega atual")).toBeVisible();
    expect(screen.queryByText("Entrega anterior")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 80,00")).toBeVisible();
    expect(screen.getByRole("button", { name: "Próximo período" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
    expect(screen.getByLabelText("Mês do faturamento")).toHaveValue("2026-08");
    expect(screen.getByText("Entrega anterior")).toBeVisible();
    expect(screen.queryByText("Entrega atual")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mês do faturamento"), { target: { value: "2026-07" } });
    expect(screen.getByText("Entrega de julho")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao atual" }));
    expect(screen.getByText("Entrega atual")).toBeVisible();
  });
  it("não inventa faturamento em períodos vazios", () => {
    renderAgency();
    fireEvent.change(screen.getByLabelText("Mês do faturamento"), { target: { value: "2025-01" } });
    expect(screen.getByText("Nenhuma tarefa concluída neste ciclo.")).toBeVisible();
    const metric = screen.getByText("Valor do ciclo").closest(".metric-card")!;
    expect(within(metric as HTMLElement).getByText("R$ 0,00")).toBeVisible();
  });
  it("busca entregas ausentes da tela inicial e ignora respostas de um período já abandonado", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(Response.json({ tasks: [tasks[1]] }));
    vi.stubGlobal("fetch", fetchMock);
    renderAgency(false);
    expect(screen.getByRole("button", { name: "CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
    await waitFor(() => expect(screen.getByText("Entrega anterior")).toBeVisible());
    await act(async () => resolveFirst(Response.json({ tasks: [tasks[0]] })));
    expect(screen.queryByText("Entrega atual")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toContain("periodStart=2026-07-15T03%3A00%3A00.000Z");
  });
  it("mostra erro recuperável em vez de valores parciais", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "Falha de consulta" } }, { status: 500 })).mockResolvedValueOnce(Response.json({ tasks: [tasks[0]] })));
    renderAgency(false);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Falha de consulta"));
    expect(screen.getByRole("button", { name: "CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText("Entrega atual")).toBeVisible());
  });
});
