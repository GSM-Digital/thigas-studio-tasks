import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { clientInputSchema } from "@/lib/domain/client";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ clientId: z.uuid() });

export async function PATCH(request: Request, context: { params: Promise<{ clientId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { clientId } = paramsSchema.parse(await context.params);
    const input = await parseJson(request, clientInputSchema);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .update({ name: input.name, color: input.color })
      .eq("id", clientId)
      .eq("agency_id", viewer.agencyId)
      .eq("active", true)
      .select("id, name, color")
      .maybeSingle();

    if (error?.code === "23505") {
      throw new ApiError(409, "CLIENT_NAME_CONFLICT", "Já existe um cliente ativo com esse nome.");
    }
    if (error) throw new ApiError(500, "CLIENT_UPDATE_FAILED", "Não foi possível atualizar o cliente.");
    if (!data) throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
    return Response.json({ client: data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ clientId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { clientId } = paramsSchema.parse(await context.params);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .update({ active: false })
      .eq("id", clientId)
      .eq("agency_id", viewer.agencyId)
      .eq("active", true)
      .select("id")
      .maybeSingle();

    if (error) throw new ApiError(500, "CLIENT_DELETE_FAILED", "Não foi possível remover o cliente.");
    if (!data) throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
    return Response.json({ removedClientId: data.id });
  } catch (error) {
    return jsonError(error);
  }
}
