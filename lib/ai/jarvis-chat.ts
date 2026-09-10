import { z } from "zod";
import {
  createGeminiStructuredClient,
  type StructuredGenerationClient,
} from "@/lib/ai/gemini";
import { isValidPointsForLevel } from "@/lib/domain/points";
import { getServerEnv } from "@/lib/env";
import { JARVIS_EVALUATION_GUIDE } from "@/lib/ai/classifier";
import type { ClientSummary, TaskClassification } from "@/lib/types";

const missingFieldSchema = z.enum([
  "tarefa",
  "cliente",
  "prazo_estimado",
  "prazo_entrega",
]);

export const jarvisChatOutputSchema = z.object({
  acao: z.enum(["perguntar", "criar_tarefa"]),
  resposta: z.string().min(1).max(600),
  titulo: z.string().max(240).nullable(),
  cliente_id: z.string().nullable(),
  prazo_estimado_segundos: z.number().int().positive().max(359_999_999).nullable(),
  prazo_entrega_iso: z.string().nullable(),
  nivel_complexidade: z.number().int().min(1).max(4).nullable(),
  pontos_base: z.number().int().min(1).max(100).nullable(),
  justificativa: z.string().max(600).nullable(),
  campos_faltantes: z.array(missingFieldSchema).max(4),
});

type JarvisChatOutput = z.infer<typeof jarvisChatOutputSchema>;

export interface JarvisChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type JarvisChatDecision =
  | {
      action: "ask";
      message: string;
      missingFields: Array<z.infer<typeof missingFieldSchema>>;
    }
  | {
      action: "create_task";
      message: string;
      task: {
        title: string;
        clientId: string;
        estimatedDurationSeconds: number;
        dueAt: string;
        classification: TaskClassification;
      };
    };

export type JarvisChatClient = StructuredGenerationClient;

const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;
const jarvisChatOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: [
    "acao",
    "resposta",
    "titulo",
    "cliente_id",
    "prazo_estimado_segundos",
    "prazo_entrega_iso",
    "nivel_complexidade",
    "pontos_base",
    "justificativa",
    "campos_faltantes",
  ],
  required: [
    "acao",
    "resposta",
    "titulo",
    "cliente_id",
    "prazo_estimado_segundos",
    "prazo_entrega_iso",
    "nivel_complexidade",
    "pontos_base",
    "justificativa",
    "campos_faltantes",
  ],
  properties: {
    acao: { type: "string", enum: ["perguntar", "criar_tarefa"] },
    resposta: { type: "string" },
    titulo: nullableString,
    cliente_id: nullableString,
    prazo_estimado_segundos: nullableInteger,
    prazo_entrega_iso: nullableString,
    nivel_complexidade: nullableInteger,
    pontos_base: nullableInteger,
    justificativa: nullableString,
    campos_faltantes: {
      type: "array",
      items: {
        type: "string",
        enum: ["tarefa", "cliente", "prazo_estimado", "prazo_entrega"],
      },
    },
  },
} as const;

const CHAT_INSTRUCTIONS = `${JARVIS_EVALUATION_GUIDE}

Você também atua como assistente de entrada de demandas. Analise toda a conversa e decida entre:
- "perguntar": quando faltar tarefa, cliente existente, prazo estimado de execução ou data/hora de entrega.
- "criar_tarefa": somente quando todos esses dados estiverem inequívocos.

Regras obrigatórias:
- Nunca invente um cliente. Use exclusivamente o ID de um cliente da lista fornecida.
- Interprete expressões como "amanhã", "sexta" e "às 15h" usando a data/hora e o fuso informados.
- O prazo estimado é a quantidade de trabalho prevista (por exemplo, 2 horas). O prazo de entrega é a data e hora limite.
- Se o usuário informar uma data sem horário, pergunte o horário.
- Para criar uma tarefa, retorne todos os campos preenchidos, campos_faltantes vazio e calcule apenas pontos base. Como ainda não há tempo real, a pontuação final será igual aos pontos base.
- Para perguntar, deixe como null todo campo ainda desconhecido e faça uma pergunta curta, natural e em português do Brasil.
- Não afirme que a tarefa foi criada. A aplicação confirmará isso somente após salvar no banco.`;

function normalizeDueAt(value: string | null, now: Date): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) return null;
  return date.toISOString();
}

function fallbackQuestion(output: JarvisChatOutput): JarvisChatDecision {
  return {
    action: "ask",
    message: output.resposta,
    missingFields: output.campos_faltantes,
  };
}

export async function interpretJarvisConversation(
  messages: JarvisChatMessage[],
  clients: ClientSummary[],
  options: {
    now?: Date;
    timezone?: string;
    client?: JarvisChatClient;
    model?: string;
  } = {},
): Promise<JarvisChatDecision> {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? "America/Sao_Paulo";
  const model = options.model ?? getServerEnv().GEMINI_CLASSIFICATION_MODEL;
  const client = options.client ?? createGeminiStructuredClient();
  const clientCatalog = clients.map((item) => ({ id: item.id, nome: item.name }));
  const conversation = messages
    .map((message) => `${message.role === "user" ? "Usuário" : "Jarvis"}: ${message.content}`)
    .join("\n");

  const result = await client.generateStructured({
    model,
    systemInstruction: CHAT_INSTRUCTIONS,
    prompt: [
      `Data/hora atual: ${now.toISOString()}`,
      `Fuso da agência: ${timezone}`,
      `Clientes ativos: ${JSON.stringify(clientCatalog)}`,
      "",
      "Conversa:",
      conversation,
    ].join("\n"),
    responseJsonSchema: jarvisChatOutputJsonSchema,
    maxOutputTokens: 700,
    timeoutMs: 15_000,
  });

  const output = jarvisChatOutputSchema.parse(result);
  if (output.acao !== "criar_tarefa") return fallbackQuestion(output);

  const title = output.titulo?.trim();
  const clientExists = clients.some((item) => item.id === output.cliente_id);
  const dueAt = normalizeDueAt(output.prazo_entrega_iso, now);
  const level = output.nivel_complexidade;
  const basePoints = output.pontos_base;
  const hasValidClassification =
    level !== null &&
    basePoints !== null &&
    isValidPointsForLevel(level, basePoints);

  if (
    !title ||
    title.length < 3 ||
    !output.cliente_id ||
    !clientExists ||
    !output.prazo_estimado_segundos ||
    !dueAt ||
    !hasValidClassification ||
    !output.justificativa
  ) {
    return {
      action: "ask",
      message: "Preciso confirmar os dados da demanda. Qual é a tarefa, o cliente, a estimativa de horas e a data e hora de entrega?",
      missingFields: output.campos_faltantes,
    };
  }

  return {
    action: "create_task",
    message: output.resposta,
    task: {
      title,
      clientId: output.cliente_id,
      estimatedDurationSeconds: output.prazo_estimado_segundos,
      dueAt,
      classification: {
        complexityLevel: level,
        basePoints,
        efficiencyAdjustment: 0,
        finalPoints: basePoints,
        rationale: output.justificativa,
        model,
      },
    },
  };
}
