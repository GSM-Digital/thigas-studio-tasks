// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyTask: vi.fn(),
  from: vi.fn(),
  getTaskView: vi.fn(),
}));

vi.mock("@/lib/ai/classifier", () => ({ classifyTask: mocks.classifyTask }));
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
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null }),
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
    mocks.getTaskView.mockReset();
  });

  it("persiste a data e hora do prazo junto com a tarefa", async () => {
    const clients = clientQuery();
    const tasks = taskQuery();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mocks.from.mockReturnValueOnce(clients).mockReturnValueOnce(tasks);
    mocks.classifyTask.mockResolvedValue({ complexityLevel: 2, basePoints: 8, efficiencyAdjustment: 0, finalPoints: 8, rationale: "Setup moderado.", model: "gemini-3.6-flash" });
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
    expect(tasks.insert).toHaveBeenCalledWith(expect.objectContaining({ due_at: dueAt }));
    expect(mocks.getTaskView).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
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
