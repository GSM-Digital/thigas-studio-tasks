import { z } from "zod";

export const DEFAULT_CLIENT_COLOR = "#007CFF";

export const clientInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default(DEFAULT_CLIENT_COLOR),
});

export type ClientInput = z.infer<typeof clientInputSchema>;

const CLIENT_COLORS = [
  "#007CFF",
  "#AF52DE",
  "#FF2D55",
  "#FF9500",
  "#34C759",
  "#5AC8FA",
] as const;

export function normalizeClientName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function findClientByName<T extends { name: string }>(
  clients: T[],
  name: string,
): T | undefined {
  const normalized = normalizeClientName(name);
  return clients.find((client) => normalizeClientName(client.name) === normalized);
}

export function pickClientColor(name: string): string {
  const hash = Array.from(normalizeClientName(name)).reduce(
    (value, character) => ((value * 31) + character.codePointAt(0)!) >>> 0,
    0,
  );
  return CLIENT_COLORS[hash % CLIENT_COLORS.length] ?? DEFAULT_CLIENT_COLOR;
}
