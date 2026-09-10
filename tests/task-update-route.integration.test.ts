// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getTaskView: vi.fn(),
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
vi.mock("@/lib/ai/reevaluate-task", () => ({ reevaluateCompletedTask: vi.fn() }));

import { PATCH } from "@/app/api/tasks/[taskId]/route";

const taskId = "44444444-4444-4444-8444-444444444444";

describe("PATCH /api/tasks/[taskId]", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getTaskView.mockReset();
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
});
