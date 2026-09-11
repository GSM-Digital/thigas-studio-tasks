// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", agencyId: "22222222-2222-4222-8222-222222222222", role: "developer", name: "Dev" }),
  requireDeveloper: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })) }));
vi.mock("@/lib/ai/task-suggestions", () => ({ generateTaskSuggestions: mocks.generate }));

import { POST } from "@/app/api/tasks/[taskId]/suggestions/route";

const taskId = "44444444-4444-4444-8444-444444444444";
const row = {
  id: "55555555-5555-4555-8555-555555555555", agency_id: "22222222-2222-4222-8222-222222222222", task_id: taskId,
  position: 1, title: "Fazer cópia de segurança", description: "Salvar todos os arquivos antes de publicar.", category: "essential" as const,
  reward_percentage: 3, omission_penalty_percentage: 10, evidence_required: true, tools: ["Supabase"], status: "pending" as const,
  evidence: null, completed_at: null, verification_status: "pending" as const, verification_rationale: null, verified_at: null,
  created_at: "2026-09-11T12:00:00.000Z", updated_at: "2026-09-11T12:00:00.000Z",
};

function listQuery(data: unknown[]) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn().mockResolvedValue({ data, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query;
}

describe("POST /api/tasks/[taskId]/suggestions", () => {
  beforeEach(() => { mocks.from.mockReset(); mocks.generate.mockReset(); });

  it("reutiliza sugestões salvas sem gastar uma nova chamada de IA", async () => {
    mocks.from.mockReturnValue(listQuery([row]));
    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/suggestions`, { method: "POST" }), { params: Promise.resolve({ taskId }) });
    expect(response.status).toBe(200);
    expect(mocks.generate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ cached: true, suggestions: [{ title: "Fazer cópia de segurança", rewardPercentage: 3 }] });
  });

  it("gera, salva e devolve o checklist na primeira abertura", async () => {
    const firstList = listQuery([]);
    const finalList = listQuery([row]);
    const taskQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: taskId, title: "Migrar site", description: null, client_id: "33333333-3333-4333-8333-333333333333", status: "open", complexity_level: 3, estimated_duration_seconds: 14_400, due_at: "2030-01-01T18:00:00.000Z" }, error: null }) };
    taskQuery.select.mockReturnValue(taskQuery); taskQuery.eq.mockReturnValue(taskQuery);
    const clientQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { name: "Make One" }, error: null }) };
    clientQuery.select.mockReturnValue(clientQuery); clientQuery.eq.mockReturnValue(clientQuery);
    const insertQuery = { insert: vi.fn().mockResolvedValue({ error: null }) };
    let suggestionCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "tasks") return taskQuery;
      if (table === "clients") return clientQuery;
      suggestionCalls += 1;
      return suggestionCalls === 1 ? firstList : suggestionCalls === 2 ? insertQuery : finalList;
    });
    mocks.generate.mockResolvedValue([{ title: row.title, description: row.description, category: row.category, rewardPercentage: 3, omissionPenaltyPercentage: 10, evidenceRequired: true, tools: ["Supabase"] }]);

    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/suggestions`, { method: "POST" }), { params: Promise.resolve({ taskId }) });
    expect(response.status).toBe(201);
    expect(insertQuery.insert).toHaveBeenCalledWith([expect.objectContaining({ task_id: taskId, position: 1, reward_percentage: 3 })]);
    await expect(response.json()).resolves.toMatchObject({ cached: false, suggestions: [{ category: "essential" }] });
  });
});
