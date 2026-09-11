import { describe, expect, it, vi } from "vitest";
import { generateTaskSuggestions } from "@/lib/ai/task-suggestions";
import type { StructuredGenerationClient } from "@/lib/ai/gemini";

describe("sugestões geradas pelo Jarvis", () => {
  it("normaliza bônus, penalidades e linguagem do contrato", async () => {
    const client: StructuredGenerationClient = {
      generateStructured: vi.fn().mockResolvedValue({ sugestoes: [
        { titulo: "Fazer backup antes do deploy", descricao: "Salve todos os arquivos e anexe um print da tela antes do deploy.", categoria: "follow_up", percentual_bonus: 5, percentual_penalidade_omissao: 2, exige_evidencia: false, ferramentas: ["Supabase", "Supabase"] },
        { titulo: "Validar os formulários", descricao: "Envie um teste e corrija os bugs antes do deadline.", categoria: "recommended", percentual_bonus: 4, percentual_penalidade_omissao: 12, exige_evidencia: true, ferramentas: [] },
        { titulo: "Fazer follow-up", descricao: "Confirme com o cliente se a entrega atende ao pedido inicial.", categoria: "follow_up", percentual_bonus: 4, percentual_penalidade_omissao: 9, exige_evidencia: false, ferramentas: [] },
      ] }),
    };

    const suggestions = await generateTaskSuggestions({
      title: "Migrar landing page", description: null, clientName: "Make One",
      complexityLevel: 3, estimatedDurationSeconds: 14_400, dueAt: "2030-01-01T18:00:00.000Z",
    }, client, "test-model");

    expect(suggestions).toEqual([
      expect.objectContaining({ title: "Fazer cópia de segurança antes da publicação", description: "Salve todos os arquivos e anexe uma captura de tela antes da publicação.", category: "essential", rewardPercentage: 3, omissionPenaltyPercentage: 5, evidenceRequired: true, tools: ["Supabase"] }),
      expect.objectContaining({ description: "Envie um teste e corrija os erros antes do prazo.", category: "recommended", rewardPercentage: 3, omissionPenaltyPercentage: 0, evidenceRequired: true }),
      expect.objectContaining({ category: "follow_up", rewardPercentage: 2, omissionPenaltyPercentage: 0 }),
    ]);
    expect(client.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      operation: "task_suggestions",
      maxOutputTokens: 1_100,
      systemInstruction: expect.stringContaining("palavras simples"),
    }));
  });
});
