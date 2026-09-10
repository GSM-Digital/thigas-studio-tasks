import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { ApiError, jsonError } from "@/lib/http";
import type { Database } from "@/lib/database.types";

function validSecret(request: Request, expected: string): boolean {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const received = Buffer.from(value);
  const target = Buffer.from(expected);
  return received.length === target.length && timingSafeEqual(received, target);
}

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (!env.CRON_SECRET || !env.SUPABASE_SECRET_KEY) {
      throw new ApiError(503, "CRON_NOT_CONFIGURED", "Credenciais do job não configuradas.");
    }
    if (!validSecret(request, env.CRON_SECRET)) {
      throw new ApiError(401, "INVALID_CRON_SECRET", "Credencial do job inválida.");
    }
    const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("generate_monthly_billing_cycles", {
      target_date: new Date().toISOString().slice(0, 10),
    });
    if (error) throw new ApiError(500, "BILLING_JOB_FAILED", error.message);
    return Response.json({ generatedCycles: data, executedAt: new Date().toISOString() });
  } catch (error) {
    return jsonError(error);
  }
}
