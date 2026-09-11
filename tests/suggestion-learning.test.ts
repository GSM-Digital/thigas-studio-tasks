import { describe, expect, it } from "vitest";
import {
  buildSuggestionLearningProfile,
  removeLearnedIrrelevantSuggestions,
  suggestionLearningPrompt,
  type HistoricalSuggestionFeedback,
} from "@/lib/ai/suggestion-learning";
import type { GeneratedTaskSuggestion } from "@/lib/ai/task-suggestions";

function feedback(overrides: Partial<HistoricalSuggestionFeedback> = {}): HistoricalSuggestionFeedback {
  return {
    taskTitle: "Otimizar os textos da primeira seção da landing page",
    taskDescription: "Revisar a comunicação principal da página.",
    suggestionTitle: "Fazer cópia de segurança antes da publicação",
    suggestionDescription: "Salve uma cópia completa antes de alterar os textos.",
    reason: "A plataforma mantém histórico automático e a alteração é somente de texto.",
    outcome: "not_applicable",
    ...overrides,
  };
}

function suggestion(overrides: Partial<GeneratedTaskSuggestion> = {}): GeneratedTaskSuggestion {
  return {
    title: "Criar cópia de segurança",
    description: "Salve todos os arquivos antes de publicar.",
    category: "essential",
    rewardPercentage: 3,
    omissionPenaltyPercentage: 10,
    evidenceRequired: true,
    tools: [],
    ...overrides,
  };
}

describe("aprendizado das sugestões do Jarvis", () => {
  it("bloqueia um tema rejeitado repetidamente em tarefas semelhantes", () => {
    const profile = buildSuggestionLearningProfile(
      { title: "Otimizar textos da primeira seção da LP", description: "Melhorar a comunicação do destaque." },
      [feedback(), feedback({ taskTitle: "Ajustar os textos da primeira seção da landing page" })],
    );

    expect(profile.avoid).toEqual([expect.objectContaining({ topic: "copia_de_seguranca", occurrences: 2 })]);
    expect(removeLearnedIrrelevantSuggestions([
      suggestion(),
      suggestion({ title: "Revisar a clareza do texto", description: "Confirme se a mensagem principal está fácil de entender.", category: "recommended", omissionPenaltyPercentage: 0 }),
    ], profile)).toEqual([expect.objectContaining({ title: "Revisar a clareza do texto" })]);
    expect(suggestionLearningPrompt(profile)).toContain("nao_repetir");
  });

  it("trata uma única dispensa como cautela, sem bloquear automaticamente", () => {
    const profile = buildSuggestionLearningProfile(
      { title: "Otimizar textos da primeira seção da LP" },
      [feedback()],
    );

    expect(profile.avoid).toHaveLength(0);
    expect(profile.caution).toHaveLength(1);
    expect(removeLearnedIrrelevantSuggestions([suggestion()], profile)).toHaveLength(1);
  });

  it("não transfere uma preferência para tarefas sem contexto semelhante", () => {
    const profile = buildSuggestionLearningProfile(
      { title: "Migrar hospedagem e DNS do site" },
      [feedback(), feedback({ taskTitle: "Alterar os textos do banner principal" })],
    );

    expect(profile.relevantFeedbackCount).toBe(0);
    expect(profile.avoid).toHaveLength(0);
  });

  it("usa sugestões realizadas como contrapeso aos sinais negativos", () => {
    const history = [
      feedback(),
      feedback({ taskTitle: "Ajustar textos do banner da landing page" }),
      feedback({ outcome: "completed", reason: null }),
      feedback({ outcome: "completed", reason: null, taskTitle: "Revisar textos da primeira seção" }),
    ];
    const profile = buildSuggestionLearningProfile({ title: "Otimizar textos da primeira seção" }, history);

    expect(profile.avoid).toHaveLength(0);
    expect(profile.prefer).toEqual([expect.objectContaining({ topic: "copia_de_seguranca", occurrences: 2 })]);
  });
});
