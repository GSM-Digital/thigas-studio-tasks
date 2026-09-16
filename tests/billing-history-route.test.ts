// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), viewer: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireViewer: mocks.viewer }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ from: mocks.from }) }));
import { GET } from "@/app/api/reports/tasks/route";

const url = "http://localhost/api/reports/tasks?periodStart=2026-08-15T03:00:00Z&periodEnd=2026-10-15T03:00:00Z";
beforeEach(() => { vi.clearAllMocks(); mocks.viewer.mockResolvedValue({ agencyId: "my-agency" }); });
describe("consulta histórica", () => {
  it("pagina além de 500 entregas com filtro da agência e ordem estável", async () => {
    const record = { id: "old", title: "Entrega", client_id: "client", status: "completed", points: 3 };
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(), range: vi.fn() };
    for (const key of ["select", "eq", "in", "gte", "lt", "order"] as const) query[key].mockReturnValue(query);
    query.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => ({ ...record, id: String(index) })), error: null }).mockResolvedValueOnce({ data: [record], error: null });
    mocks.from.mockImplementation((table) => table === "tasks" ? query : { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "client", name: "Cliente", color: "blue" }], error: null }) }) });
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tasks).toHaveLength(501);
    expect(body.tasks[500].clientName).toBe("Cliente");
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(query.eq).toHaveBeenCalledWith("agency_id", "my-agency");
    expect(query.in).toHaveBeenCalledWith("status", ["completed", "approved"]);
    expect(query.order).toHaveBeenCalledWith("id");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejeita período invertido antes de consultar o banco", async () => {
    const response = await GET(new Request(url.replace("2026-08-15", "2026-11-15")));
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
