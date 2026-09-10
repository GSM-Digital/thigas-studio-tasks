import { z } from "zod";
import {
  createGeminiStructuredClient,
  type StructuredGenerationClient,
} from "@/lib/ai/gemini";
import {
  calculateExecutionAdjustment,
  type ExecutionBonusPercentage,
} from "@/lib/domain/points";
import { formatDuration } from "@/lib/domain/time";
import { getServerEnv } from "@/lib/env";

const completionOutputSchema = z.object({
  bonus_execucao_percentual: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
  ]),
  justificativa_bonus: z.string().trim().min(20).max(600),
});

const completionJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: ["bonus_execucao_percentual", "justificativa_bonus"],
  required: ["bonus_execucao_percentual", "justificativa_bonus"],
  properties: {
    bonus_execucao_percentual: { type: "integer", enum: [0, 5, 10, 15, 20] },
    justificativa_bonus: { type: "string" },
  },
} as const;

export const JARVIS_COMPLETION_PROMPT = `Você é Jarvis, um Gerente de Projetos de Tecnologia e Avaliador de Produtividade sênior. Avalie o relato de conclusão de uma tarefa e decida se houve mérito técnico adicional além do escopo normal já remunerado pelos pontos-base.

REGRAS DO BÔNUS DE EXECUÇÃO
- 0%: execução normal, relato genérico, apenas conclusão/validação prevista, retrabalho causado pelo próprio desenvolvedor ou ausência de evidência concreta.
- 5%: pequeno imprevisto externo resolvido ou melhoria útil e comprovável fora do fluxo básico.
- 10%: problema técnico relevante, dependência externa ou risco real resolvido com boa iniciativa.
- 15%: obstáculo significativo que exigiu investigação, solução robusta ou evitou impacto importante para o cliente.
- 20%: resolução excepcional e claramente demonstrada de problema crítico, trabalho adicional substancial ou prevenção de alto risco.

O relato não ganha pontos apenas por ser detalhado. Não invente fatos, não premie tarefas já previstas no escopo e nunca aplique penalidade nesta etapa. Escolha somente 0, 5, 10, 15 ou 20. Escreva a justificativa em português do Brasil e deixe claro quais evidências do relato sustentam a decisão.`;

export interface CompletionEvaluationInput {
  title: string;
  description?: string | null;
  completionSummary: string;
  basePoints: number;
  estimatedDurationSeconds: number;
  actualDurationSeconds: number;
}

export interface CompletionEvaluation {
  percentage: ExecutionBonusPercentage;
  adjustment: number;
  rationale: string;
  model: string;
}

export async function evaluateTaskCompletion(
  input: CompletionEvaluationInput,
  client: StructuredGenerationClient = createGeminiStructuredClient(),
  model = getServerEnv().GEMINI_CLASSIFICATION_MODEL,
): Promise<CompletionEvaluation> {
  const output = await client.generateStructured({
    model,
    systemInstruction: JARVIS_COMPLETION_PROMPT,
    prompt: [
      `Tarefa: ${input.title}`,
      `Descrição original: ${input.description?.trim() || "não informada"}`,
      `Pontos base: ${input.basePoints}`,
      `SLA: ${formatDuration(input.estimatedDurationSeconds)}`,
      `Tempo real: ${formatDuration(input.actualDurationSeconds)}`,
      `Relato de conclusão: ${input.completionSummary}`,
    ].join("\n"),
    responseJsonSchema: completionJsonSchema,
    maxOutputTokens: 450,
    timeoutMs: 12_000,
  });
  const parsed = completionOutputSchema.parse(output);
  return {
    percentage: parsed.bonus_execucao_percentual,
    adjustment: calculateExecutionAdjustment(input.basePoints, parsed.bonus_execucao_percentual),
    rationale: parsed.justificativa_bonus,
    model,
  };
}
