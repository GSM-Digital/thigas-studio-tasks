import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
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

export interface JarvisChatClient {
  responses: {
    parse(input: unknown): Promise<{ output_parsed: JarvisChatOutput | null }>;
  };
}

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

function createOpenAIClient(): OpenAI {
  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada.");
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 15_000 });
}

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
  const model = options.model ?? getServerEnv().OPENAI_CLASSIFICATION_MODEL;
  const client = options.client ?? createOpenAIClient();
  const clientCatalog = clients.map((item) => ({ id: item.id, nome: item.name }));

  const response = await client.responses.parse({
    model,
    store: false,
    prompt_cache_key: "jarvis-task-intake-v1",
    reasoning: { effort: "none" },
    max_output_tokens: 700,
    input: [
      { role: "developer", content: CHAT_INSTRUCTIONS },
      {
        role: "developer",
        content: [
          `Data/hora atual: ${now.toISOString()}`,
          `Fuso da agência: ${timezone}`,
          `Clientes ativos: ${JSON.stringify(clientCatalog)}`,
        ].join("\n"),
      },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    text: { format: zodTextFormat(jarvisChatOutputSchema, "jarvis_task_intake") },
  });

  const output = response.output_parsed;
  if (!output) throw new Error("Jarvis não retornou uma resposta estruturada.");
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
