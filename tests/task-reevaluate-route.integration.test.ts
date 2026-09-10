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

import { POST } from "@/app/api/tasks/[taskId]/reevaluate/route";

const taskId = "44444444-4444-4444-8444-444444444444";

function readQuery() {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({
    data: { id: taskId, status: "completed", completion_summary: "Entrega concluída e validada no ambiente final." },
    error: null,
  });
  return query;
}

function updateQuery() {
  const query = { update: vi.fn(), eq: vi.fn() };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null });
  return query;
}

describe("POST /api/tasks/[taskId]/reevaluate", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getTaskView.mockReset();
    mocks.reevaluateCompletedTask.mockReset();
  });

  it("reavalia uma tarefa concluída usando o relato salvo", async () => {
    const read = readQuery();
    const pending = updateQuery();
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(pending);
    mocks.reevaluateCompletedTask.mockResolvedValue(undefined);
    mocks.getTaskView.mockResolvedValue({ id: taskId, status: "completed", classificationStatus: "classified", points: 13 });

    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/reevaluate`, { method: "POST" }), {
      params: Promise.resolve({ taskId }),
    });

    expect(response.status).toBe(200);
    expect(pending.update).toHaveBeenCalledWith({ classification_status: "pending" });
    expect(mocks.reevaluateCompletedTask).toHaveBeenCalledWith(taskId, "22222222-2222-4222-8222-222222222222");
    await expect(response.json()).resolves.toMatchObject({ task: { classificationStatus: "classified", points: 13 } });
  });

  it("restaura o status de falha quando o provedor não responde", async () => {
    const read = readQuery();
    const pending = updateQuery();
    const failed = updateQuery();
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(pending).mockReturnValueOnce(failed);
    mocks.reevaluateCompletedTask.mockRejectedValue(new Error("DEADLINE_EXCEEDED"));

    const response = await POST(new Request(`http://localhost/api/tasks/${taskId}/reevaluate`, { method: "POST" }), {
      params: Promise.resolve({ taskId }),
    });

    expect(response.status).toBe(503);
    expect(failed.update).toHaveBeenCalledWith({ classification_status: "failed" });
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "JARVIS_REEVALUATION_FAILED" },
    });
  });
});
