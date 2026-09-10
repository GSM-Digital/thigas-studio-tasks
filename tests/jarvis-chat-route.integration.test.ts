// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interpret: vi.fn(),
  resolveClient: vi.fn(),
  from: vi.fn(),
  getTaskView: vi.fn(),
}));

vi.mock("@/lib/ai/jarvis-chat", () => ({
  interpretJarvisConversation: mocks.interpret,
}));
vi.mock("@/lib/clients/resolve", () => ({ resolveOrCreateClient: mocks.resolveClient }));
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

import { POST } from "@/app/api/jarvis/chat/route";

function agencyQuery() {
  const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue({ data: { timezone: "America/Sao_Paulo" }, error: null });
  return query;
}

function clientsQuery() {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockResolvedValue({
    data: [{ id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" }],
    error: null,
  });
  return query;
}

function taskQuery() {
  const query = { insert: vi.fn(), select: vi.fn(), single: vi.fn() };
  query.insert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null });
  return query;
}

describe("POST /api/jarvis/chat", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.interpret.mockReset();
    mocks.resolveClient.mockReset();
    mocks.resolveClient.mockResolvedValue({
      client: { id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" },
      created: false,
    });
    mocks.getTaskView.mockReset();
  });

  it("salva a demanda validada pelo Jarvis e retorna a tarefa", async () => {
    const agencies = agencyQuery();
    const clients = clientsQuery();
    const tasks = taskQuery();
    const taskView = {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Configurar GA4",
      clientName: "Make One",
      complexityLevel: 2,
      points: 10,
    };
    mocks.from.mockImplementation((table: string) => ({ agencies, clients, tasks })[table as "agencies" | "clients" | "tasks"]);
    mocks.interpret.mockResolvedValue({
      action: "create_task",
      message: "Entendi.",
      task: {
        title: "Configurar GA4",
        description: "Validar eventos.",
        clientId: "33333333-3333-4333-8333-333333333333",
        clientName: "Make One",
        estimatedDurationSeconds: 7200,
        dueAt: "2030-04-18T18:00:00.000Z",
        classification: {
          complexityLevel: 2,
          basePoints: 10,
          efficiencyAdjustment: 0,
          finalPoints: 10,
          rationale: "Configuração moderada de ferramenta externa.",
          model: "gemini-3.6-flash",
        },
      },
    });
    mocks.getTaskView.mockResolvedValue(taskView);

    const response = await POST(new Request("http://localhost/api/jarvis/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Crie a demanda de GA4." }] }),
    }));

    expect(response.status).toBe(201);
    expect(tasks.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "Configurar GA4",
      description: "Validar eventos.",
      points: 10,
      due_at: "2030-04-18T18:00:00.000Z",
    }));
    await expect(response.json()).resolves.toMatchObject({ task: taskView });
  });

  it("não grava nada enquanto o Jarvis precisa perguntar", async () => {
    const agencies = agencyQuery();
    const clients = clientsQuery();
    mocks.from.mockImplementation((table: string) => ({ agencies, clients })[table as "agencies" | "clients"]);
    mocks.interpret.mockResolvedValue({
      action: "ask",
      message: "Qual é o prazo de entrega?",
      missingFields: ["prazo_entrega"],
    });

    const response = await POST(new Request("http://localhost/api/jarvis/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Crie uma demanda de GA4." }] }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Qual é o prazo de entrega?",
      task: null,
      client: null,
      clientCreated: false,
    });
  });
});
