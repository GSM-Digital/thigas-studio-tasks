import { z } from "zod";
import {
  createGeminiStructuredClient,
  type StructuredGenerationClient,
} from "@/lib/ai/gemini";
import { isValidPointsForLevel } from "@/lib/domain/points";
import { findClientByName } from "@/lib/domain/client";
import { getServerEnv } from "@/lib/env";
import { JARVIS_COMPLEXITY_GUIDE } from "@/lib/ai/classifier";
import type { ClientSummary, TaskClassification } from "@/lib/types";

const missingFieldSchema = z.enum([
  "tarefa",
  "cliente",
  "prazo_entrega",
]);

export const jarvisChatOutputSchema = z.object({
  acao: z.enum(["perguntar", "criar_tarefa"]),
  resposta: z.string().min(1).max(600),
  titulo: z.string().max(240).nullable(),
  descricao: z.string().max(4_000).nullable(),
  cliente_nome: z.string().trim().min(2).max(120).nullable(),
  prazo_estimado_segundos: z.number().int().min(900).max(1_440_000).nullable(),
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
        description: string | null;
        clientId: string | null;
        clientName: string;
        estimatedDurationSeconds: number;
        dueAt: string;
        classification: TaskClassification;
      };
    };

export type JarvisChatClient = StructuredGenerationClient;

const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;
const IMMEDIATE_TIMESTAMP_TOLERANCE_MS = 60_000;
const jarvisChatOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: [
    "acao",
    "resposta",
    "titulo",
    "descricao",
    "cliente_nome",
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
    "descricao",
    "cliente_nome",
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
    descricao: nullableString,
    cliente_nome: nullableString,
    prazo_estimado_segundos: { type: ["integer", "null"], minimum: 900, maximum: 1_440_000 },
    prazo_entrega_iso: nullableString,
    nivel_complexidade: nullableInteger,
    pontos_base: nullableInteger,
    justificativa: nullableString,
    campos_faltantes: {
      type: "array",
      items: {
        type: "string",
        enum: ["tarefa", "cliente", "prazo_entrega"],
      },
    },
  },
} as const;

const CHAT_INSTRUCTIONS = `${JARVIS_COMPLEXITY_GUIDE}

Você também atua como assistente de entrada de demandas. Analise toda a conversa e decida entre:
- "perguntar": quando faltar a tarefa, um cliente identificável ou a data/hora de entrega.
- "criar_tarefa": quando esses dados estiverem inequívocos. A estimativa de execução nunca é obrigatória: estime-a quando o usuário não informar.

Regras obrigatórias:
- Se o cliente já estiver na lista, repita exatamente o nome do catálogo.
- Se o usuário mencionar explicitamente um cliente que não está na lista, preserve o nome em cliente_nome. A aplicação fará o cadastro automático.
- Nunca invente um cliente quando ele não estiver explícito na conversa.
- Interprete expressões como "amanhã", "sexta" e "às 15h" usando a data/hora e o fuso informados.
- "Para agora", "pra agora", "vou fazer agora", "começar agora", "urgente para execução imediata" e equivalentes indicam início imediato. Não pergunte data ou hora nesses casos: estime um SLA realista e use como prazo de entrega a data/hora atual somada ao SLA estimado.
- Se houver início imediato e também um limite explícito, como "preciso terminar até 14h", preserve esse limite explícito como prazo de entrega.
- O prazo estimado é a quantidade de trabalho prevista (por exemplo, 2 horas). O prazo de entrega é a data e hora limite.
- Se o prazo estimado não for informado, estime o tempo de trabalho focado de um Desenvolvedor Web sênior, em incrementos de 15 minutos.
- Se o usuário informar uma data sem horário, pergunte o horário.
- Se faltar o prazo de entrega, pergunte claramente: "Até quando essa demanda precisa ser entregue? Informe a data e a hora."
- Use descricao para preservar anotações e detalhes adicionais; deixe null quando não houver observações além do título.
- Para criar uma tarefa, retorne todos os campos preenchidos, campos_faltantes vazio e calcule apenas pontos base. Como ainda não há tempo real, a pontuação final será igual aos pontos base.
- Para perguntar, deixe como null todo campo ainda desconhecido e faça uma pergunta curta, natural e em português do Brasil.
- Não afirme que a tarefa foi criada. A aplicação confirmará isso somente após salvar no banco.`;

function normalizeDueAt(value: string | null, now: Date): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) return null;
  return date.toISOString();
}

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function hasImmediateStartIntent(messages: JarvisChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = normalizeIntentText(message.content);
    if (
      /\bnao\s+(?:e\s+)?(?:para|pra)\s+(?:agora|ja)\b/.test(text) ||
      /\bsem\s+urgencia\b/.test(text)
    ) {
      return false;
    }
    if (
      /\b(?:para|pra)\s+(?:agora|ja)\b/.test(text) ||
      /\b(?:vou|irei)\s+(?:fazer|executar|resolver|comecar|iniciar|pegar).{0,60}\b(?:agora|ja|neste momento)\b/.test(text) ||
      /\b(?:comecar|iniciar|fazer|executar|resolver)\s+(?:isso|ela|essa|esta|a)?\s*(?:demanda|tarefa)?\s*(?:agora|ja|neste momento)\b/.test(text) ||
      /\b(?:urgente|urgencia)\b.{0,60}\b(?:agora|ja|imediato|imediata|imediatamente)\b/.test(text) ||
      /\b(?:agora|ja|imediato|imediata|imediatamente)\b.{0,60}\b(?:urgente|urgencia)\b/.test(text) ||
      /\b(?:imediato|imediata|imediatamente)\b/.test(text)
    ) {
      return true;
    }
  }
  return false;
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
  const clientCatalog = clients.map((item) => item.name);
  const conversation = messages
    .map((message) => `${message.role === "user" ? "Usuário" : "Jarvis"}: ${message.content}`)
    .join("\n");
  const immediateStart = hasImmediateStartIntent(messages);

  let usedModel = model;
  const result = await client.generateStructured({
    operation: "jarvis_chat",
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
    maxOutputTokens: 520,
    timeoutMs: 15_000,
    onModelUsed: (selectedModel) => { usedModel = selectedModel; },
  });

  const output = jarvisChatOutputSchema.parse(result);
  if (output.acao !== "criar_tarefa" && !immediateStart) return fallbackQuestion(output);

  const title = output.titulo?.trim();
  const clientByName = output.cliente_nome
    ? findClientByName(clients, output.cliente_nome)
    : undefined;
  const resolvedClient = clientByName;
  const clientName = resolvedClient?.name ?? output.cliente_nome?.trim();
  const estimatedDurationSeconds = output.prazo_estimado_segundos
    ? Math.max(900, Math.min(1_440_000, Math.round(output.prazo_estimado_segundos / 900) * 900))
    : null;
  const explicitDueAt = normalizeDueAt(output.prazo_entrega_iso, now);
  const providerUsedCurrentTime = explicitDueAt
    ? new Date(explicitDueAt).getTime() <= now.getTime() + IMMEDIATE_TIMESTAMP_TOLERANCE_MS
    : true;
  const dueAt = immediateStart && estimatedDurationSeconds && providerUsedCurrentTime
    ? new Date(now.getTime() + estimatedDurationSeconds * 1000).toISOString()
    : explicitDueAt;
  const level = output.nivel_complexidade;
  const basePoints = output.pontos_base;
  const hasValidClassification =
    level !== null &&
    basePoints !== null &&
    isValidPointsForLevel(level, basePoints);

  if (
    !title ||
    title.length < 3 ||
    !clientName ||
    !estimatedDurationSeconds ||
    !dueAt ||
    !hasValidClassification ||
    !output.justificativa
  ) {
    if (output.acao === "perguntar") return fallbackQuestion(output);
    return {
      action: "ask",
      message: !dueAt
        ? "Até quando essa demanda precisa ser entregue? Informe a data e a hora."
        : "Preciso confirmar qual é a tarefa e para qual cliente ela deve ser vinculada.",
      missingFields: output.campos_faltantes,
    };
  }

  return {
    action: "create_task",
    message: output.resposta,
    task: {
      title,
      description: output.descricao?.trim() || null,
      clientId: resolvedClient?.id ?? null,
      clientName,
      estimatedDurationSeconds,
      dueAt,
      classification: {
        complexityLevel: level,
        basePoints,
        efficiencyAdjustment: 0,
        finalPoints: basePoints,
        rationale: output.justificativa,
        model: usedModel,
      },
    },
  };
}
