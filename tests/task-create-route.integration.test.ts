// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyTask: vi.fn(),
  resolveClient: vi.fn(),
  from: vi.fn(),
  getTaskView: vi.fn(),
}));

vi.mock("@/lib/ai/classifier", () => ({ classifyTask: mocks.classifyTask }));
vi.mock("@/lib/clients/resolve", () => ({ resolveOrCreateClient: mocks.resolveClient }));
vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", agencyId: "22222222-2222-4222-8222-222222222222", role: "developer", name: "Dev" }),
  requireDeveloper: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));
vi.mock("@/lib/task-view", () => ({ getTaskView: mocks.getTaskView }));

import { POST } from "@/app/api/tasks/route";

function clientQuery() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({ data: [{ id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" }], error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function taskQuery() {
  const query = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null }),
  };
  query.insert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("POST /api/tasks", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.classifyTask.mockReset();
    mocks.resolveClient.mockReset();
    mocks.resolveClient.mockResolvedValue({
      client: { id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" },
      created: false,
    });
    mocks.getTaskView.mockReset();
  });

  it("persiste a data e hora do prazo junto com a tarefa", async () => {
    const clients = clientQuery();
    const tasks = taskQuery();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mocks.from.mockReturnValueOnce(clients).mockReturnValueOnce(tasks);
    mocks.classifyTask.mockResolvedValue({ complexityLevel: 2, basePoints: 8, efficiencyAdjustment: 0, finalPoints: 8, rationale: "Setup moderado.", model: "gemini-3.6-flash", estimatedDurationSeconds: 7200, estimateSource: "user", clientName: "Make One" });
    mocks.getTaskView.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", dueAt });

    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Configurar os eventos do GA4",
        clientId: "33333333-3333-4333-8333-333333333333",
        estimatedDurationSeconds: 7200,
        dueAt,
      }),
    }));

    expect(response.status).toBe(201);
    expect(tasks.insert).toHaveBeenCalledWith(expect.objectContaining({ due_at: dueAt, estimated_duration_seconds: 7200 }));
    expect(mocks.getTaskView).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
  });

  it("usa a estimativa calculada pelo Jarvis quando o SLA não é informado", async () => {
    const clients = clientQuery();
    const tasks = taskQuery();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mocks.from.mockReturnValueOnce(clients).mockReturnValueOnce(tasks);
    mocks.classifyTask.mockResolvedValue({ complexityLevel: 2, basePoints: 10, efficiencyAdjustment: 0, finalPoints: 10, rationale: "Estimativa automática.", model: "gemini-3.6-flash", estimatedDurationSeconds: 10_800, estimateSource: "jarvis", clientName: "Make One" });
    mocks.getTaskView.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", dueAt });

    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Configurar eventos avançados do GA4",
        clientId: "33333333-3333-4333-8333-333333333333",
        estimatedDurationSeconds: null,
        dueAt,
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.classifyTask).toHaveBeenCalledWith({
      title: "Configurar eventos avançados do GA4",
      description: null,
      clients: [{ id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" }],
      selectedClientId: "33333333-3333-4333-8333-333333333333",
      estimatedDurationSeconds: null,
    });
    expect(tasks.insert).toHaveBeenCalledWith(expect.objectContaining({
      estimated_duration_seconds: 10_800,
      classification_metadata: expect.objectContaining({ estimated_duration_source: "jarvis" }),
    }));
  });

  it("aceita cliente não selecionado e retorna o cliente criado pelo Jarvis", async () => {
    const clients = clientQuery();
    const tasks = taskQuery();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const fullBody = { id: "55555555-5555-4555-8555-555555555555", name: "Full Body", color: "#AF52DE" };
    mocks.from.mockReturnValueOnce(clients).mockReturnValueOnce(tasks);
    mocks.classifyTask.mockResolvedValue({
      complexityLevel: 2,
      basePoints: 12,
      efficiencyAdjustment: 0,
      finalPoints: 12,
      rationale: "Implementação moderada de formulário.",
      model: "gemini-3.6-flash",
      estimatedDurationSeconds: 7200,
      estimateSource: "jarvis",
      clientName: "Full Body",
    });
    mocks.resolveClient.mockResolvedValue({ client: fullBody, created: true });
    mocks.getTaskView.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", clientName: "Full Body", dueAt });

    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Implementar formulário LP - Full Body",
        description: "Integrar ao CRM e validar mensagens de erro.",
        clientId: null,
        estimatedDurationSeconds: null,
        dueAt,
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.resolveClient).toHaveBeenCalledWith(expect.objectContaining({
      clientId: null,
      clientName: "Full Body",
    }));
    expect(tasks.insert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: fullBody.id,
      description: "Integrar ao CRM e validar mensagens de erro.",
    }));
    await expect(response.json()).resolves.toMatchObject({ client: fullBody, clientCreated: true });
  });

  it("recusa prazo no passado antes de classificar a tarefa", async () => {
    const response = await POST(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Configurar os eventos do GA4",
        clientId: "33333333-3333-4333-8333-333333333333",
        estimatedDurationSeconds: 7200,
        dueAt: "2020-01-01T10:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.classifyTask).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
