import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SECRET_KEY: z.string().min(10).optional(),
  GEMINI_API_KEY: z.string().min(20).optional(),
  GEMINI_CLASSIFICATION_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  GEMINI_FALLBACK_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  GEMINI_FALLBACK_COOLDOWN_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  CRON_SECRET: z.string().min(32).optional(),
});

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getServerEnv() {
  return serverSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_CLASSIFICATION_MODEL: process.env.GEMINI_CLASSIFICATION_MODEL,
    GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL,
    GEMINI_FALLBACK_COOLDOWN_HOURS: process.env.GEMINI_FALLBACK_COOLDOWN_HOURS,
    CRON_SECRET: process.env.CRON_SECRET,
  });
}
