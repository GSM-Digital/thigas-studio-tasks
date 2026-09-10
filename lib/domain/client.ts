import { z } from "zod";

export const DEFAULT_CLIENT_COLOR = "#007CFF";

export const clientInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default(DEFAULT_CLIENT_COLOR),
});

export type ClientInput = z.infer<typeof clientInputSchema>;
