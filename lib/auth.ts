import { cache } from "react";
import { ApiError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/types";

export const requireViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiError(401, "UNAUTHENTICATED", "Faça login para continuar.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, agency_id, full_name, role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    throw new ApiError(403, "PROFILE_NOT_FOUND", "Perfil de acesso não encontrado.");
  }

  return {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    agencyId: profile.agency_id,
  };
});

export function requireDeveloper(viewer: Viewer): void {
  if (viewer.role !== "developer") {
    throw new ApiError(403, "READ_ONLY", "A visão Agência é somente leitura.");
  }
}

export function requireAgency(viewer: Viewer): void {
  if (viewer.role !== "agency") {
    throw new ApiError(403, "AGENCY_ONLY", "Apenas a agência pode aprovar entregas.");
  }
}
