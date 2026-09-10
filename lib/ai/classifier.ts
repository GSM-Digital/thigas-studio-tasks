import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { calculateEfficiencyScore, isValidPointsForLevel } from "@/lib/domain/points";
import { formatDuration } from "@/lib/domain/time";
import { getServerEnv } from "@/lib/env";
import type { TaskClassification } from "@/lib/types";

export const jarvisOutputSchema = z.object({
  nivel_complexidade: z.number().int().min(1).max(4),
  pontos_base: z.number().int().min(1).max(100),
  bonus_ou_penalidade: z.string().regex(/^[+-]\d+$/),
  pontuacao_final: z.number().int().min(1).max(140),
  justificativa: z.string().min(20).max(600),
});

export type JarvisOutput = z.infer<typeof jarvisOutputSchema>;

export interface ClassificationInput {
  title: string;
  estimatedDurationSeconds: number;
  actualDurationSeconds?: number | null;
}

export const JARVIS_SYSTEM_PROMPT = `Você é Jarvis, um Gerente de Projetos de Tecnologia e Avaliador de Produtividade sênior. Sua função é calcular a pontuação final de tarefas de um Desenvolvedor Web em duas etapas: complexidade técnica e impacto (pontos base), seguida do fator de eficiência (comparação entre prazo estimado/SLA e tempo real gasto).

Retorne APENAS um objeto JSON válido com exatamente: "nivel_complexidade", "pontos_base", "bonus_ou_penalidade", "pontuacao_final" e "justificativa".

ETAPA 1 — PONTOS BASE
- Nível 1 (1–4 pts): microtarefas, gestão de conteúdo e comunicação; baixo esforço cognitivo, sem risco estrutural, operação repetitiva ou alteração visual simples. Exemplos: alinhar domínio/hospedagem; analisar links; seguir ajustes do web designer; publicar artigo; criar Gmail; alterar tipografia, foto ou links; inserir assinaturas de e-mail.
- Nível 2 (5–15 pts): setups, configurações e bugs moderados; ferramentas externas, formulários, scripts e correções com análise de código. Exemplos: implementar formulário; configurar Nuvemshop; corrigir carrossel; apontar LP na Lovable; configurar GA4 ou Leadster; apontar domínios.
- Nível 3 (20–35 pts): implementações parciais, infraestrutura e migrações; alto risco operacional, DNS, banco de dados ou parte significativa de projeto. Exemplos: migrar landing page; desenvolver protótipo de LP; implementar seção/página de obrigado; migrar hospedagem; configurar WordPress em servidor novo.
- Nível 4 (50–100 pts): projetos core e deep work; ativo completo do zero, alto esforço cognitivo e desenvolvimento integral. Exemplos: implementar página principal; todas as páginas; finalizar todas as páginas; LP HTML do zero; LP com formulário condicional.

ETAPA 2 — EFICIÊNCIA
- Sem tempo real informado: use "+0" e mantenha a pontuação final igual aos pontos base.
- Gasto abaixo de 50% do prazo: super eficiente. Use +40% se abaixo de 25%, +30% entre 25% e abaixo de 40%, ou +20% entre 40% e abaixo de 50%.
- Gasto entre 50% e 100% do prazo, inclusive: dentro do esperado; use +0%.
- Gasto acima de 100%: atraso. Use -20% até 125%, -35% acima de 125% e até 150%, ou -50% acima de 150%.
- Arredonde o bônus ou a penalidade em pontos para o inteiro mais próximo e calcule pontuacao_final = pontos_base + bônus/penalidade.

Seja rigoroso, considere risco, dependências, ambiguidade e esforço. Escreva a justificativa em português do Brasil.`;

export interface ClassifierClient {
  responses: {
    parse(input: unknown): Promise<{ output_parsed: JarvisOutput | null }>;
  };
}

function createOpenAIClient(): OpenAI {
  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada.");
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 12_000 });
}

export async function classifyTask(
  input: ClassificationInput,
  client: ClassifierClient = createOpenAIClient(),
  model = getServerEnv().OPENAI_CLASSIFICATION_MODEL,
): Promise<TaskClassification> {
  const actualDuration = input.actualDurationSeconds ?? null;
  const response = await client.responses.parse({
    model,
    input: [
      { role: "developer", content: JARVIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Tarefa: ${input.title}`,
          `Prazo Estimado: ${formatDuration(input.estimatedDurationSeconds)}`,
          `Tempo Real Gasto: ${actualDuration && actualDuration > 0 ? formatDuration(actualDuration) : "não informado"}`,
        ].join("\n"),
      },
    ],
    reasoning: { effort: "none" },
    text: { format: zodTextFormat(jarvisOutputSchema, "jarvis_task_score") },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("Jarvis não retornou uma avaliação estruturada.");
  if (!isValidPointsForLevel(parsed.nivel_complexidade, parsed.pontos_base)) {
    throw new Error("A pontuação base retornada não pertence à faixa do nível informado.");
  }

  const efficiency = calculateEfficiencyScore(
    parsed.pontos_base,
    input.estimatedDurationSeconds,
    actualDuration,
  );

  return {
    complexityLevel: parsed.nivel_complexidade,
    basePoints: parsed.pontos_base,
    efficiencyAdjustment: efficiency.adjustment,
    finalPoints: efficiency.finalPoints,
    rationale: parsed.justificativa,
    model,
  };
}

export function toJarvisOutput(classification: TaskClassification): JarvisOutput {
  return {
    nivel_complexidade: classification.complexityLevel,
    pontos_base: classification.basePoints,
    bonus_ou_penalidade: `${classification.efficiencyAdjustment >= 0 ? "+" : ""}${classification.efficiencyAdjustment}`,
    pontuacao_final: classification.finalPoints,
    justificativa: classification.rationale,
  };
}
