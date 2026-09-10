import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  clientInputSchema,
  findClientByName,
  pickClientColor,
} from "@/lib/domain/client";
import { ApiError } from "@/lib/http";
import type { ClientSummary } from "@/lib/types";

interface ResolveClientInput {
  supabase: SupabaseClient<Database>;
  agencyId: string;
  clients: ClientSummary[];
  clientId?: string | null;
  clientName?: string | null;
}

export interface ResolvedClient {
  client: ClientSummary;
  created: boolean;
}

export async function resolveOrCreateClient({
  supabase,
  agencyId,
  clients,
  clientId,
  clientName,
}: ResolveClientInput): Promise<ResolvedClient> {
  if (clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
    return { client: selected, created: false };
  }

  const parsed = clientInputSchema.safeParse({
    name: clientName,
    color: pickClientColor(clientName ?? ""),
  });
  if (!parsed.success) {
    throw new ApiError(
      400,
      "CLIENT_REQUIRED",
      "Selecione um cliente ou informe o nome na demanda, por exemplo: “Implementar formulário LP - Full Body”.",
    );
  }

  const existing = findClientByName(clients, parsed.data.name);
  if (existing) return { client: existing, created: false };

  const { data, error } = await supabase
    .from("clients")
    .insert({
      agency_id: agencyId,
      name: parsed.data.name,
      color: parsed.data.color,
      active: true,
    })
    .select("id, name, color")
    .single();

  if (!error && data) return { client: data, created: true };

  if (error?.code === "23505") {
    const { data: concurrentClients, error: reloadError } = await supabase
      .from("clients")
      .select("id, name, color")
      .eq("agency_id", agencyId)
      .eq("active", true);
    const concurrent = findClientByName(concurrentClients ?? [], parsed.data.name);
    if (!reloadError && concurrent) return { client: concurrent, created: false };
  }

  console.error("Automatic client creation failed", error);
  throw new ApiError(500, "CLIENT_CREATE_FAILED", "Não foi possível criar o cliente automaticamente.");
}
