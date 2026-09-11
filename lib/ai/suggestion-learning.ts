export interface HistoricalSuggestionFeedback {
  taskTitle: string;
  taskDescription: string | null;
  suggestionTitle: string;
  suggestionDescription: string;
  reason: string | null;
  outcome: "not_applicable" | "completed";
}

interface LearnableSuggestion {
  title: string;
  description: string;
}

export interface SuggestionLearningRule {
  key: string;
  topic: string | null;
  example: string;
  occurrences: number;
  reasons: string[];
}

export interface SuggestionLearningProfile {
  relevantFeedbackCount: number;
  avoid: SuggestionLearningRule[];
  caution: SuggestionLearningRule[];
  prefer: SuggestionLearningRule[];
}

const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos",
  "o", "os", "para", "por", "que", "um", "uma", "tarefa", "demanda", "cliente", "site", "pagina", "paginas",
  "lp", "landing", "page", "web", "fazer", "realizar", "implementar", "criar", "ajustar", "alterar", "configurar",
  "adicionar", "inserir", "novo", "nova",
]);

const TOPICS: Array<{ key: string; pattern: RegExp }> = [
  { key: "copia_de_seguranca", pattern: /\b(?:backup|copia de seguranca|restauracao|ponto de retorno|rollback)\b/ },
  { key: "ambiente_de_testes", pattern: /\b(?:staging|ambiente de testes?|homologacao|producao)\b/ },
  { key: "testes", pattern: /\b(?:testar|teste|validar|validacao|conferir|verificar|controle de qualidade)\b/ },
  { key: "responsividade", pattern: /\b(?:responsiv|celular|mobile|tablet|tamanhos de tela)\w*\b/ },
  { key: "formularios", pattern: /\b(?:formulario|campos?|envio|lead|captura)\w*\b/ },
  { key: "comunicacao", pattern: /\b(?:follow-up|retorno|avisar|comunicar|confirmar com|aprovacao do cliente)\b/ },
  { key: "documentacao", pattern: /\b(?:documentar|documentacao|registrar alteracoes|registro tecnico)\b/ },
  { key: "desempenho", pattern: /\b(?:desempenho|performance|velocidade|carregamento|pagespeed|core web vitals)\b/ },
  { key: "seo", pattern: /\b(?:seo|busca organica|meta descricao|titulo da pagina|indexacao)\b/ },
  { key: "acessibilidade", pattern: /\b(?:acessibilidade|contraste|leitor de tela|texto alternativo|alt)\b/ },
  { key: "metricas", pattern: /\b(?:ga4|analytics|tag manager|gtm|evento|conversao|rastreamento)\b/ },
  { key: "seguranca", pattern: /\b(?:seguranca|permissao|credencial|vulnerabilidade|ssl|https)\b/ },
  { key: "migracao", pattern: /\b(?:migracao|migrar|transferencia|dns|dominio|hospedagem)\b/ },
  { key: "conteudo", pattern: /\b(?:texto|conteudo|imagem|foto|artigo|post)\w*\b/ },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  if (intersection === 0) return 0;
  const coverage = intersection / Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return coverage * 0.7 + (intersection / union) * 0.3;
}

function taskSimilarity(
  current: { title: string; description?: string | null },
  historical: { taskTitle: string; taskDescription: string | null },
): number {
  const titleScore = textSimilarity(current.title, historical.taskTitle);
  const contextScore = textSimilarity(
    `${current.title} ${current.description ?? ""}`,
    `${historical.taskTitle} ${historical.taskDescription ?? ""}`,
  );
  return Math.max(titleScore, contextScore * 0.85);
}

function detectTopic(value: string): string | null {
  const normalized = normalize(value);
  return TOPICS.find((topic) => topic.pattern.test(normalized))?.key ?? null;
}

function feedbackKey(feedback: HistoricalSuggestionFeedback): { key: string; topic: string | null } {
  const topic = detectTopic(`${feedback.suggestionTitle} ${feedback.suggestionDescription}`);
  if (topic) return { key: `topic:${topic}`, topic };
  const signature = [...tokens(`${feedback.suggestionTitle} ${feedback.suggestionDescription}`)]
    .sort()
    .slice(0, 5)
    .join("_");
  return { key: `texto:${signature || normalize(feedback.suggestionTitle)}`, topic: null };
}

export function buildSuggestionLearningProfile(
  currentTask: { title: string; description?: string | null },
  history: HistoricalSuggestionFeedback[],
): SuggestionLearningProfile {
  const relevant = history
    .map((feedback) => ({ feedback, similarity: taskSimilarity(currentTask, feedback) }))
    .filter(({ similarity }) => similarity >= 0.42)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 40);

  const groups = new Map<string, {
    topic: string | null;
    example: string;
    negative: number;
    positive: number;
    reasons: string[];
  }>();

  for (const { feedback } of relevant) {
    const signature = feedbackKey(feedback);
    const group = groups.get(signature.key) ?? {
      topic: signature.topic,
      example: feedback.suggestionTitle,
      negative: 0,
      positive: 0,
      reasons: [],
    };
    if (feedback.outcome === "not_applicable") {
      group.negative += 1;
      const compactReason = feedback.reason?.replace(/\s+/g, " ").trim().slice(0, 160);
      if (compactReason && !group.reasons.includes(compactReason)) group.reasons.push(compactReason);
    } else {
      group.positive += 1;
    }
    groups.set(signature.key, group);
  }

  const avoid: SuggestionLearningRule[] = [];
  const caution: SuggestionLearningRule[] = [];
  const prefer: SuggestionLearningRule[] = [];

  for (const [key, group] of groups) {
    const total = group.negative + group.positive;
    const negativeRate = total > 0 ? group.negative / total : 0;
    const base = {
      key,
      topic: group.topic,
      example: group.example,
      reasons: group.reasons.slice(0, 1),
    };
    if (group.negative >= 2 && negativeRate >= 0.67) {
      avoid.push({ ...base, occurrences: group.negative });
    } else if (group.negative > 0) {
      caution.push({ ...base, occurrences: group.negative });
    }
    if (group.positive >= 2 && group.positive > group.negative) {
      prefer.push({ ...base, occurrences: group.positive });
    }
  }

  return {
    relevantFeedbackCount: relevant.length,
    avoid: avoid.sort((left, right) => right.occurrences - left.occurrences).slice(0, 4),
    caution: caution.sort((left, right) => right.occurrences - left.occurrences).slice(0, 2),
    prefer: prefer.sort((left, right) => right.occurrences - left.occurrences).slice(0, 2),
  };
}

function matchesRule(suggestion: LearnableSuggestion, rule: SuggestionLearningRule): boolean {
  const text = `${suggestion.title} ${suggestion.description}`;
  const topic = detectTopic(text);
  if (rule.topic && topic === rule.topic) return true;
  return textSimilarity(text, rule.example) >= 0.55;
}

export function removeLearnedIrrelevantSuggestions<TSuggestion extends LearnableSuggestion>(
  suggestions: TSuggestion[],
  profile: SuggestionLearningProfile,
): TSuggestion[] {
  return suggestions.filter((suggestion) => !profile.avoid.some((rule) => matchesRule(suggestion, rule)));
}

export function suggestionLearningPrompt(profile: SuggestionLearningProfile): string {
  if (profile.relevantFeedbackCount === 0) return "Ainda não há feedback relevante para este tipo de tarefa.";
  const format = (rule: SuggestionLearningRule) => ({
    sugestao: rule.example,
    ocorrencias: rule.occurrences,
    motivos: rule.reasons,
  });
  return JSON.stringify({
    nao_repetir: profile.avoid.map(format),
    evitar_se_nao_for_realmente_util: profile.caution.map(format),
    historicamente_uteis: profile.prefer.map(format),
  });
}
