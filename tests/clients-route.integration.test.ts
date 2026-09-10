// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), terminal: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({ id: "user-1", agencyId: "agency-1", role: "developer", name: "Dev" }),
  requireDeveloper: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));

import { POST } from "@/app/api/clients/route";
import { DELETE, PATCH } from "@/app/api/clients/[clientId]/route";

const clientId = "11111111-1111-4111-8111-111111111111";

describe("API de clientes", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.terminal.mockReset();
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["insert", "update", "eq", "select"]) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.single = mocks.terminal;
    chain.maybeSingle = mocks.terminal;
    mocks.from.mockReturnValue(chain);
  });

  it("cria cliente validado no tenant autenticado", async () => {
    mocks.terminal.mockResolvedValue({ data: { id: clientId, name: "Acme", color: "#007CFF" }, error: null });
    const response = await POST(new Request("http://localhost/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Acme  ", color: "#007CFF" }),
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ client: { id: clientId, name: "Acme", color: "#007CFF" } });
  });

  it("rejeita cor inválida antes de consultar o banco", async () => {
    const response = await POST(new Request("http://localhost/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme", color: "azul" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("atualiza nome e cor de um cliente ativo", async () => {
    mocks.terminal.mockResolvedValue({ data: { id: clientId, name: "Acme Brasil", color: "#AF52DE" }, error: null });
    const response = await PATCH(new Request(`http://localhost/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Brasil", color: "#AF52DE" }),
    }), { params: Promise.resolve({ clientId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ client: { name: "Acme Brasil" } });
  });

  it("remove por arquivamento, preservando referências históricas", async () => {
    mocks.terminal.mockResolvedValue({ data: { id: clientId }, error: null });
    const response = await DELETE(new Request(`http://localhost/api/clients/${clientId}`, {
      method: "DELETE",
    }), { params: Promise.resolve({ clientId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removedClientId: clientId });
  });
});
