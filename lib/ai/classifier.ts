import { z } from "zod";
import {
  createGeminiStructuredClient,
  type StructuredGenerationClient,
} from "@/lib/ai/gemini";
import { calculateEfficiencyScore, isValidPointsForLevel } from "@/lib/domain/points";
import { formatDuration } from "@/lib/domain/time";
import { getServerEnv } from "@/lib/env";
import type { ClientSummary, TaskClassification } from "@/lib/types";

export const jarvisOutputSchema = z.object({
  nivel_complexidade: z.number().int().min(1).max(4),
  pontos_base: z.number().int().min(1).max(100),
  cliente_nome: z.string().trim().min(2).max(120).nullable(),
  prazo_estimado_segundos: z.number().int().min(900).max(1_440_000),
  bonus_ou_penalidade: z.string().regex(/^[+-]\d+$/),
  pontuacao_final: z.number().int().min(1).max(140),
  justificativa: z.string().min(20).max(600),
});

export type JarvisOutput = z.infer<typeof jarvisOutputSchema>;

export interface ClassificationInput {
  title: string;
  description?: string | null;
  clients?: ClientSummary[];
  selectedClientId?: string | null;
  estimatedDurationSeconds?: number | null;
  actualDurationSeconds?: number | null;
}

export type ClassifiedTask = TaskClassification & {
  estimatedDurationSeconds: number;
  estimateSource: "user" | "jarvis";
  clientName: string | null;
};

export const JARVIS_COMPLEXITY_GUIDE = `Você é Jarvis, Gerente de Projetos de Tecnologia sênior. Classifique a complexidade técnica e o impacto de tarefas de Desenvolvimento Web com rigor.

PONTOS BASE
- Nível 1 (1–4 pts): microtarefas, gestão de conteúdo e comunicação; baixo esforço cognitivo, sem risco estrutural, operação repetitiva ou alteração visual simples. Exemplos: alinhar domínio/hospedagem; analisar links; seguir ajustes do web designer; publicar artigo; criar Gmail; alterar tipografia, foto ou links; inserir assinaturas de e-mail.
- Nível 2 (5–15 pts): setups, configurações e bugs moderados; ferramentas externas, formulários, scripts e correções com análise de código. Exemplos: implementar formulário; configurar Nuvemshop; corrigir carrossel; apontar LP na Lovable; configurar GA4 ou Leadster; apontar domínios.
- Nível 3 (20–35 pts): implementações parciais, infraestrutura e migrações; alto risco operacional, DNS, banco de dados ou parte significativa de projeto. Exemplos: migrar landing page; desenvolver protótipo de LP; implementar seção/página de obrigado; migrar hospedagem; configurar WordPress em servidor novo.
- Nível 4 (50–100 pts): projetos core e deep work; ativo completo do zero, alto esforço cognitivo e desenvolvimento integral. Exemplos: implementar página principal; todas as páginas; finalizar todas as páginas; LP HTML do zero; LP com formulário condicional.

Considere risco, dependências, ambiguidade e esforço. Escreva uma justificativa objetiva em português do Brasil, com no máximo duas frases.`;

export const JARVIS_EFFICIENCY_GUIDE = `EFICIÊNCIA — calculada deterministicamente pela aplicação
- Sem tempo real informado: use "+0" e mantenha a pontuação final igual aos pontos base.
- Gasto abaixo de 50% do prazo: super eficiente. Use +40% se abaixo de 25%, +30% entre 25% e abaixo de 40%, ou +20% entre 40% e abaixo de 50%.
- Gasto entre 50% e 100% do prazo, inclusive: dentro do esperado; use +0%.
- Gasto acima de 100%: atraso. Use -20% até 125%, -35% acima de 125% e até 150%, ou -50% acima de 150%.
- Arredonde o ajuste em pontos para o inteiro mais próximo e calcule pontuacao_final = pontos_base + ajuste.`;

export const JARVIS_EVALUATION_GUIDE = `${JARVIS_COMPLEXITY_GUIDE}\n\n${JARVIS_EFFICIENCY_GUIDE}`;

export const JARVIS_SYSTEM_PROMPT = `${JARVIS_COMPLEXITY_GUIDE}

ESTIMATIVA DE EXECUÇÃO
- Retorne em prazo_estimado_segundos o tempo médio de trabalho focado de um Desenvolvedor Web sênior para executar e validar a tarefa.
- Quando o usuário fornecer o prazo estimado, repita esse valor. Quando estiver "não informado", estime-o com base no escopo técnico descrito.
- Use incrementos de 15 minutos, com mínimo de 900 segundos e máximo de 1.440.000 segundos.
- Não confunda o prazo estimado de execução com a data limite de entrega.

IDENTIFICAÇÃO DO CLIENTE
- Retorne em cliente_nome o nome do cliente explícito na tarefa, incluindo formatos como "Tarefa - Cliente".
- Quando houver cliente selecionado, repita exatamente o nome desse cliente.
- Quando o nome corresponder ao catálogo de clientes ativos, repita exatamente o nome do catálogo.
- Se houver um nome explícito que ainda não exista no catálogo, preserve esse nome para que a aplicação possa cadastrá-lo.
- Se nenhum cliente puder ser identificado sem inventar, retorne null.

Retorne APENAS o JSON estruturado solicitado. A aplicação calcula eficiência e pontuação final sem usar a IA.`;

export type ClassifierClient = StructuredGenerationClient;

const jarvisOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: [
    "nivel_complexidade",
    "pontos_base",
    "cliente_nome",
    "prazo_estimado_segundos",
    "bonus_ou_penalidade",
    "pontuacao_final",
    "justificativa",
  ],
  required: [
    "nivel_complexidade",
    "pontos_base",
    "cliente_nome",
    "prazo_estimado_segundos",
    "bonus_ou_penalidade",
    "pontuacao_final",
    "justificativa",
  ],
  properties: {
    nivel_complexidade: { type: "integer", minimum: 1, maximum: 4 },
    pontos_base: { type: "integer", minimum: 1, maximum: 100 },
    cliente_nome: { type: ["string", "null"] },
    prazo_estimado_segundos: { type: "integer", minimum: 900, maximum: 1_440_000 },
    bonus_ou_penalidade: { type: "string" },
    pontuacao_final: { type: "integer", minimum: 1, maximum: 140 },
    justificativa: { type: "string" },
  },
} as const;

const classifierAiOutputSchema = jarvisOutputSchema.pick({
  nivel_complexidade: true,
  pontos_base: true,
  cliente_nome: true,
  prazo_estimado_segundos: true,
  justificativa: true,
});

const classifierAiOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: [
    "nivel_complexidade",
    "pontos_base",
    "cliente_nome",
    "prazo_estimado_segundos",
    "justificativa",
  ],
  required: [
    "nivel_complexidade",
    "pontos_base",
    "cliente_nome",
    "prazo_estimado_segundos",
    "justificativa",
  ],
  properties: {
    nivel_complexidade: jarvisOutputJsonSchema.properties.nivel_complexidade,
    pontos_base: jarvisOutputJsonSchema.properties.pontos_base,
    cliente_nome: jarvisOutputJsonSchema.properties.cliente_nome,
    prazo_estimado_segundos: jarvisOutputJsonSchema.properties.prazo_estimado_segundos,
    justificativa: jarvisOutputJsonSchema.properties.justificativa,
  },
} as const;

export async function classifyTask(
  input: ClassificationInput,
  client: ClassifierClient = createGeminiStructuredClient(),
  model = getServerEnv().GEMINI_CLASSIFICATION_MODEL,
): Promise<ClassifiedTask> {
  const actualDuration = input.actualDurationSeconds ?? null;
  const providedEstimate = input.estimatedDurationSeconds ?? null;
  const selectedClient = input.clients?.find((item) => item.id === input.selectedClientId) ?? null;
  const clientCatalog = input.clients?.map((item) => item.name) ?? [];
  const output = await client.generateStructured({
    operation: "task_classification",
    model,
    systemInstruction: JARVIS_SYSTEM_PROMPT,
    prompt: [
      `Tarefa: ${input.title}`,
      `Descrição/observações: ${input.description?.trim() || "não informada"}`,
      selectedClient
        ? `Cliente já selecionado: ${selectedClient.name}`
        : `Clientes ativos para identificação pelo texto: ${JSON.stringify(clientCatalog)}`,
      `Prazo Estimado: ${providedEstimate ? formatDuration(providedEstimate) : "não informado — estime o tempo médio"}`,
    ].join("\n"),
    responseJsonSchema: classifierAiOutputJsonSchema,
    maxOutputTokens: 360,
    timeoutMs: 12_000,
  });

  const parsed = classifierAiOutputSchema.parse(output);
  if (!isValidPointsForLevel(parsed.nivel_complexidade, parsed.pontos_base)) {
    throw new Error("A pontuação base retornada não pertence à faixa do nível informado.");
  }

  const estimatedDurationSeconds = providedEstimate ?? Math.max(
    900,
    Math.min(1_440_000, Math.round(parsed.prazo_estimado_segundos / 900) * 900),
  );

  const efficiency = calculateEfficiencyScore(
    parsed.pontos_base,
    estimatedDurationSeconds,
    actualDuration,
  );

  return {
    complexityLevel: parsed.nivel_complexidade,
    basePoints: parsed.pontos_base,
    efficiencyAdjustment: efficiency.adjustment,
    finalPoints: efficiency.finalPoints,
    rationale: parsed.justificativa,
    model,
    estimatedDurationSeconds,
    estimateSource: providedEstimate ? "user" : "jarvis",
    clientName: selectedClient?.name ?? parsed.cliente_nome,
  };
}

export function toJarvisOutput(classification: ClassifiedTask): JarvisOutput {
  return {
    nivel_complexidade: classification.complexityLevel,
    pontos_base: classification.basePoints,
    cliente_nome: classification.clientName,
    prazo_estimado_segundos: classification.estimatedDurationSeconds,
    bonus_ou_penalidade: `${classification.efficiencyAdjustment >= 0 ? "+" : ""}${classification.efficiencyAdjustment}`,
    pontuacao_final: classification.finalPoints,
    justificativa: classification.rationale,
  };
}
