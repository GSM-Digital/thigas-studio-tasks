// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getTaskView: vi.fn(),
  reevaluateCompletedTask: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    agencyId: "22222222-2222-4222-8222-222222222222",
    role: "developer",
    name: "Dev",
  }),
  requireDeveloper: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));
vi.mock("@/lib/task-view", () => ({ getTaskView: mocks.getTaskView }));
vi.mock("@/lib/ai/reevaluate-task", () => ({ reevaluateCompletedTask: mocks.reevaluateCompletedTask }));

import { PATCH } from "@/app/api/tasks/[taskId]/route";

const taskId = "44444444-4444-4444-8444-444444444444";

describe("PATCH /api/tasks/[taskId]", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getTaskView.mockReset();
    mocks.reevaluateCompletedTask.mockReset();
  });

  it("persiste a descrição opcional sem alterar o status", async () => {
    const query = { update: vi.fn(), eq: vi.fn() };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValue(query);
    mocks.getTaskView.mockResolvedValue({ id: taskId, description: "Validar no ambiente de homologação." });

    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "  Validar no ambiente de homologação.  " }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ description: "Validar no ambiente de homologação." });
    expect(query.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }));
    await expect(response.json()).resolves.toMatchObject({ task: { description: "Validar no ambiente de homologação." } });
  });

  it("recusa descrições acima do limite antes de acessar o banco", async () => {
    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "x".repeat(4_001) }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("persiste um novo prazo futuro", async () => {
    const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const query = { update: vi.fn(), eq: vi.fn() };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValue(query);
    mocks.getTaskView.mockResolvedValue({ id: taskId, dueAt });

    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueAt }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ due_at: dueAt });
    await expect(response.json()).resolves.toMatchObject({ task: { dueAt } });
  });

  it("recusa um prazo no passado antes de acessar o banco", async () => {
    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueAt: "2020-01-01T10:00:00.000Z" }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("valida e troca o cliente dentro da mesma agência", async () => {
    const clientId = "55555555-5555-4555-8555-555555555555";
    const clientsQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    clientsQuery.select.mockReturnValue(clientsQuery);
    clientsQuery.eq.mockReturnValue(clientsQuery);
    clientsQuery.maybeSingle.mockResolvedValue({ data: { id: clientId }, error: null });
    const tasksQuery = { update: vi.fn(), eq: vi.fn() };
    tasksQuery.update.mockReturnValue(tasksQuery);
    tasksQuery.eq.mockReturnValueOnce(tasksQuery).mockResolvedValueOnce({ error: null });
    mocks.from.mockImplementation((table: string) => table === "clients" ? clientsQuery : tasksQuery);
    mocks.getTaskView.mockResolvedValue({ id: taskId, clientId, clientName: "Novo Cliente" });

    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(200);
    expect(clientsQuery.eq).toHaveBeenCalledWith("agency_id", "22222222-2222-4222-8222-222222222222");
    expect(clientsQuery.eq).toHaveBeenCalledWith("active", true);
    expect(tasksQuery.update).toHaveBeenCalledWith({ client_id: clientId });
  });

  it("exige um relato antes de concluir a tarefa", async () => {
    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("salva o relato e solicita a avaliação final do Jarvis", async () => {
    const completionSummary = "Resolvi uma incompatibilidade do script e validei todos os eventos no ambiente final.";
    const timerQuery = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn() };
    timerQuery.select.mockReturnValue(timerQuery);
    timerQuery.eq.mockReturnValue(timerQuery);
    timerQuery.is.mockReturnValue(timerQuery);
    timerQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    const taskQuery = { update: vi.fn(), eq: vi.fn() };
    taskQuery.update.mockReturnValue(taskQuery);
    taskQuery.eq.mockReturnValueOnce(taskQuery).mockResolvedValueOnce({ error: null });
    mocks.from.mockImplementation((table: string) => table === "time_entries" ? timerQuery : taskQuery);
    mocks.reevaluateCompletedTask.mockResolvedValue(undefined);
    mocks.getTaskView.mockResolvedValue({ id: taskId, status: "completed", completionSummary, executionAdjustment: 2 });

    const response = await PATCH(new Request(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true, completionSummary }),
    }), { params: Promise.resolve({ taskId }) });

    expect(response.status).toBe(200);
    expect(taskQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      completion_summary: completionSummary,
      completion_rationale: null,
      classification_status: "pending",
    }));
    expect(mocks.reevaluateCompletedTask).toHaveBeenCalledWith(taskId, "22222222-2222-4222-8222-222222222222");
    await expect(response.json()).resolves.toMatchObject({ task: { completionSummary, executionAdjustment: 2 } });
  });
});
