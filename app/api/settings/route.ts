import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ pointValueCents: z.number().int().min(1).max(100_000_000) });

export async function PATCH(request: Request) {
  try {
    const viewer = await requireViewer();
    const { pointValueCents } = await parseJson(request, inputSchema);
    const supabase = await createClient();
    const { error } = await supabase.from("agencies").update({ point_value_cents: pointValueCents }).eq("id", viewer.agencyId);
    if (error) throw new ApiError(409, "SETTINGS_UPDATE_FAILED", error.message);
    return Response.json({ settings: { pointValueCents } });
  } catch (error) {
    return jsonError(error);
  }
}
