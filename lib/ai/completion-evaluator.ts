import { z } from "zod";
import {
  createGeminiStructuredClient,
  type StructuredGenerationClient,
} from "@/lib/ai/gemini";
import {
  calculateExecutionAdjustment,
  type ExecutionAdjustmentPercentage,
} from "@/lib/domain/points";
import { getServerEnv } from "@/lib/env";

const completionOutputSchema = z.object({
  resumo_conclusao: z.string().trim().min(20).max(1_500),
  ajuste_execucao_percentual: z.union([
    z.literal(-100),
    z.literal(-80),
    z.literal(-70),
    z.literal(-60),
    z.literal(-50),
    z.literal(-40),
    z.literal(-30),
    z.literal(-20),
    z.literal(-10),
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
  ]),
  justificativa_ajuste: z.string().trim().min(20).max(600),
});

const completionJsonSchema = {
  type: "object",
  additionalProperties: false,
  propertyOrdering: ["resumo_conclusao", "ajuste_execucao_percentual", "justificativa_ajuste"],
  required: ["resumo_conclusao", "ajuste_execucao_percentual", "justificativa_ajuste"],
  properties: {
    resumo_conclusao: { type: "string" },
    ajuste_execucao_percentual: {
      type: "integer",
      enum: [-100, -80, -70, -60, -50, -40, -30, -20, -10, 0, 5, 10, 15, 20],
    },
    justificativa_ajuste: { type: "string" },
  },
} as const;

export const JARVIS_COMPLETION_PROMPT = `Você é Jarvis, um Gerente de Projetos de Tecnologia e Avaliador de Produtividade sênior. Compare o escopo original com o relato de conclusão e avalie autoria, qualidade, cumprimento dos requisitos e retrabalho.

RESUMO DA ENTREGA
- Transforme o relato livre do desenvolvedor em um resumo profissional, claro e conciso, em português do Brasil.
- Preserve fatos relevantes: o que foi implementado, problemas encontrados, soluções aplicadas, participação de terceiros, pendências e validações realizadas.
- Remova repetições, vícios de linguagem e trechos sem valor informativo, mas nunca invente ações ou resultados.
- Escreva em primeira pessoa, em um parágrafo curto, adequado para um histórico de entrega.

REGRAS DO AJUSTE DE EXECUÇÃO
- +20%: resolução excepcional e claramente demonstrada de problema crítico, trabalho adicional substancial ou prevenção de alto risco.
- +15%: obstáculo significativo que exigiu investigação, solução robusta ou evitou impacto importante para o cliente.
- +10%: problema técnico relevante, dependência externa ou risco real resolvido com boa iniciativa.
- +5%: pequeno imprevisto externo resolvido ou melhoria útil e comprovável fora do fluxo básico.
- 0%: tarefa correta, execução normal, relato genérico, apenas conclusão/validação prevista ou ausência de evidência concreta para ajuste.
- -10%: pequena falha, acabamento pendente ou problema evitável de baixo impacto.
- -20%, -30% ou -40%: entrega incompleta ou retrabalho necessário; escolha conforme a severidade e o impacto descritos.
- -30%, -40% ou -50%: requisitos importantes ignorados; escolha conforme quantidade e impacto.
- -50%, -60%, -70% ou -80%: a maior parte foi executada por outra pessoa; escolha conforme a participação real do desenvolvedor.
- -100%: o desenvolvedor declara que não executou a tarefa.

REGRAS DE EQUIDADE
- Usar IA, automações, bibliotecas, templates ou ferramentas não reduz pontos por si só. Se o desenvolvedor conduziu, revisou, testou e assumiu a responsabilidade, considere a autoria integral.
- Ajuda pontual ou colaboração normal não reduz pontos. Penalize autoria apenas quando o relato indicar que outra pessoa realizou parte substancial do trabalho.
- Não transforme velocidade em penalidade; eficiência de tempo é calculada separadamente pelo sistema.
- Não invente falhas, autoria de terceiros ou problemas que não estejam explícitos no relato.
- O relato não ganha pontos apenas por ser detalhado. Não premie atividades já previstas no escopo.
- Escolha somente um dos percentuais permitidos e escreva a justificativa em português do Brasil, citando as evidências concretas do relato.`;

export interface CompletionEvaluationInput {
  title: string;
  description?: string | null;
  completionSummary: string;
  basePoints: number;
  estimatedDurationSeconds: number;
  actualDurationSeconds: number;
}

export interface CompletionEvaluation {
  summary: string;
  percentage: ExecutionAdjustmentPercentage;
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
    operation: "completion_evaluation",
    model,
    systemInstruction: JARVIS_COMPLETION_PROMPT,
    prompt: [
      `Tarefa: ${input.title}`,
      `Descrição original: ${input.description?.trim() || "não informada"}`,
      `Relato de conclusão: ${input.completionSummary}`,
    ].join("\n"),
    responseJsonSchema: completionJsonSchema,
    maxOutputTokens: 600,
    timeoutMs: 12_000,
  });
  const parsed = completionOutputSchema.parse(output);
  return {
    summary: parsed.resumo_conclusao,
    percentage: parsed.ajuste_execucao_percentual,
    adjustment: calculateExecutionAdjustment(input.basePoints, parsed.ajuste_execucao_percentual),
    rationale: parsed.justificativa_ajuste,
    model,
  };
}
