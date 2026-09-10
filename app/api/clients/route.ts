import { requireDeveloper, requireViewer } from "@/lib/auth";
import { clientInputSchema } from "@/lib/domain/client";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const input = await parseJson(request, clientInputSchema);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clients")
      .insert({ agency_id: viewer.agencyId, name: input.name, color: input.color, active: true })
      .select("id, name, color")
      .single();

    if (error?.code === "23505") {
      throw new ApiError(409, "CLIENT_NAME_CONFLICT", "Já existe um cliente ativo com esse nome.");
    }
    if (error || !data) throw new ApiError(500, "CLIENT_CREATE_FAILED", "Não foi possível criar o cliente.");
    return Response.json({ client: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
