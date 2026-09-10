// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrCreateClient } from "@/lib/clients/resolve";
import type { Database } from "@/lib/database.types";
import { findClientByName, normalizeClientName, pickClientColor } from "@/lib/domain/client";

const agencyId = "22222222-2222-4222-8222-222222222222";
const existing = { id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" };

describe("resolução automática de clientes", () => {
  it("normaliza espaços e caixa para reutilizar um cliente existente", async () => {
    const from = vi.fn();
    const result = await resolveOrCreateClient({
      supabase: { from } as unknown as SupabaseClient<Database>,
      agencyId,
      clients: [existing],
      clientName: "  make   one ",
    });

    expect(result).toEqual({ client: existing, created: false });
    expect(from).not.toHaveBeenCalled();
    expect(normalizeClientName("  MAKE   One ")).toBe("make one");
    expect(findClientByName([existing], "make one")).toBe(existing);
  });

  it("cria um cliente explícito inexistente com cor válida", async () => {
    const created = { id: "55555555-5555-4555-8555-555555555555", name: "Full Body", color: pickClientColor("Full Body") };
    const query = {
      insert: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    };
    query.insert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const from = vi.fn().mockReturnValue(query);

    const result = await resolveOrCreateClient({
      supabase: { from } as unknown as SupabaseClient<Database>,
      agencyId,
      clients: [existing],
      clientName: "Full Body",
    });

    expect(result).toEqual({ client: created, created: true });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      agency_id: agencyId,
      name: "Full Body",
      active: true,
      color: expect.stringMatching(/^#[0-9A-F]{6}$/),
    }));
  });

  it("não cria um nome que não foi identificado", async () => {
    await expect(resolveOrCreateClient({
      supabase: { from: vi.fn() } as unknown as SupabaseClient<Database>,
      agencyId,
      clients: [],
      clientName: null,
    })).rejects.toMatchObject({ code: "CLIENT_REQUIRED", status: 400 });
  });
});
