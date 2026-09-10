import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SECRET_KEY: z.string().min(10).optional(),
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_CLASSIFICATION_MODEL: z.string().min(1).default("gpt-5.4-nano"),
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
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_CLASSIFICATION_MODEL: process.env.OPENAI_CLASSIFICATION_MODEL,
    CRON_SECRET: process.env.CRON_SECRET,
  });
}
