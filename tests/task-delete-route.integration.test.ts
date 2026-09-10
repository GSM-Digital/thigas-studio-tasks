// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({ id: "user-1", agencyId: "agency-1", role: "developer", name: "Dev" }),
  requireDeveloper: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));

import { DELETE } from "@/app/api/tasks/[taskId]/route";

const taskId = "11111111-1111-4111-8111-111111111111";

function query(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "delete", "in"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

describe("DELETE /api/tasks/[taskId]", () => {
  beforeEach(() => mocks.from.mockReset());

  it("exclui uma tarefa aberta sem cronômetro ativo", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { id: taskId, status: "open" }, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }))
      .mockReturnValueOnce(query({ data: { id: taskId }, error: null }));

    const response = await DELETE(new Request(`http://localhost/api/tasks/${taskId}`, { method: "DELETE" }), {
      params: Promise.resolve({ taskId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removedTaskId: taskId });
  });

  it("protege tarefas concluídas", async () => {
    mocks.from.mockReturnValueOnce(query({ data: { id: taskId, status: "completed" }, error: null }));
    const response = await DELETE(new Request(`http://localhost/api/tasks/${taskId}`, { method: "DELETE" }), {
      params: Promise.resolve({ taskId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "TASK_FINALIZED" } });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("exige que o cronômetro seja parado", async () => {
    mocks.from
      .mockReturnValueOnce(query({ data: { id: taskId, status: "in_progress" }, error: null }))
      .mockReturnValueOnce(query({ data: { id: "timer-1" }, error: null }));
    const response = await DELETE(new Request(`http://localhost/api/tasks/${taskId}`, { method: "DELETE" }), {
      params: Promise.resolve({ taskId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "TIMER_RUNNING" } });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});
