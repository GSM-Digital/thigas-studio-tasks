import { z } from "zod";

export const aiErrorCategorySchema = z.enum([
  "quota_exhausted",
  "billing_required",
  "rate_limited",
  "authentication",
  "configuration",
  "model_not_found",
  "invalid_request",
  "invalid_response",
  "timeout",
  "network",
  "service_unavailable",
  "unknown",
]);

export type AiErrorCategory = z.infer<typeof aiErrorCategorySchema>;

export const aiErrorDiagnosticSchema = z.object({
  referenceId: z.string().min(6).max(80),
  provider: z.literal("Gemini"),
  category: aiErrorCategorySchema,
  status: z.number().int().min(100).max(599).nullable(),
  code: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(500),
  technicalDetail: z.string().min(1).max(900),
  occurredAt: z.string().datetime({ offset: true }),
});

export type AiErrorDiagnostic = z.infer<typeof aiErrorDiagnosticSchema>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Erro sem mensagem retornado pelo provedor.";
  }
}

function errorStatus(error: unknown, message: string): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  const match = message.match(/(?:status|code)[^\d]{0,12}(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function providerCode(message: string, status: number | null): string {
  const structured = message.match(/["'](?:status|code)["']\s*:\s*["']([A-Za-z][A-Za-z_]+)["']/)?.[1];
  if (structured) return structured;
  const known = message.match(/\b(RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT|NOT_FOUND|API_KEY_INVALID|quota_exceeded|rate_limit_exceeded|too_many_requests|failed_precondition)\b/i)?.[1];
  return known ?? (status ? `HTTP_${status}` : "UNKNOWN_PROVIDER_ERROR");
}

function redactSecrets(message: string): string {
  return message
    .replace(/AIza[\w-]{20,}/g, "[CHAVE_REDACTED]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[CHAVE_REDACTED]")
    .replace(/(bearer\s+)[\w._-]+/gi, "$1[TOKEN_REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function classify(status: number | null, code: string, message: string): AiErrorCategory {
  const normalized = `${code} ${message}`.toLowerCase();
  if (/gemini_api_key não configurada|api key.*not configured/.test(normalized)) return "configuration";
  if (/reported as leaked|api.?key.?invalid|unauthenticated|permission_denied/.test(normalized) || status === 401 || status === 403) return "authentication";
  if (/failed_precondition/.test(normalized) && /billing|faturamento/.test(normalized)) return "billing_required";
  if (/quota_exceeded|daily quota|quota.*exceed|quota.*limit|credit.*exhaust|billing quota|free tier.*limit/.test(normalized)) return "quota_exhausted";
  if (/rate_limit_exceeded|too_many_requests|per.minute|per.second|rate limit/.test(normalized)) return "rate_limited";
  if (status === 429) return "rate_limited";
  if (status === 404 || /model.*not found|not_found/.test(normalized)) return "model_not_found";
  if (status === 408 || /deadline_exceeded|timed?\s*out|timeout/.test(normalized)) return "timeout";
  if (/json|structured|zod|parse|schema|conteúdo estruturado/.test(normalized)) return "invalid_response";
  if (status === 400 || /invalid_argument|bad request/.test(normalized)) return "invalid_request";
  if (/fetch failed|network|econnreset|enotfound|socket/.test(normalized)) return "network";
  if ((status !== null && status >= 500) || /unavailable|internal server/.test(normalized)) return "service_unavailable";
  return "unknown";
}

const descriptions: Record<AiErrorCategory, { title: string; message: string }> = {
  quota_exhausted: {
    title: "Cota ou créditos da API esgotados",
    message: "O Gemini informou que a cota disponível foi consumida. Aguarde a renovação do limite ou verifique créditos e faturamento no Google AI Studio.",
  },
  billing_required: {
    title: "Faturamento da API precisa ser ativado",
    message: "O projeto do Gemini não possui o faturamento ou algum pré-requisito necessário para processar esta solicitação.",
  },
  rate_limited: {
    title: "Muitas solicitações ao Jarvis",
    message: "O limite momentâneo de requisições foi atingido. Aguarde alguns instantes e tente novamente.",
  },
  authentication: {
    title: "Chave da API inválida ou bloqueada",
    message: "O Gemini recusou a autenticação. Confirme se a chave está ativa, sem bloqueio e configurada corretamente na Vercel.",
  },
  configuration: {
    title: "API do Jarvis não configurada",
    message: "A variável GEMINI_API_KEY não está disponível no ambiente desta aplicação.",
  },
  model_not_found: {
    title: "Modelo do Jarvis indisponível",
    message: "O modelo configurado não existe, foi desativado ou não está liberado para esta chave.",
  },
  invalid_request: {
    title: "Solicitação rejeitada pelo Gemini",
    message: "O provedor considerou algum parâmetro da avaliação inválido.",
  },
  invalid_response: {
    title: "Resposta inválida do Jarvis",
    message: "O Gemini respondeu, mas o conteúdo não seguiu o formato estruturado exigido pela plataforma.",
  },
  timeout: {
    title: "Tempo de resposta esgotado",
    message: "O Gemini demorou mais do que o limite da plataforma para concluir a avaliação.",
  },
  network: {
    title: "Falha de conexão com o Gemini",
    message: "A plataforma não conseguiu estabelecer ou manter a conexão com o provedor.",
  },
  service_unavailable: {
    title: "Gemini temporariamente indisponível",
    message: "O serviço do provedor está instável ou indisponível. Tente novamente em alguns instantes.",
  },
  unknown: {
    title: "Erro não identificado no Jarvis",
    message: "A avaliação falhou por uma causa ainda não classificada. Copie o diagnóstico abaixo para análise.",
  },
};

export function createAiErrorDiagnostic(error: unknown, now = new Date()): AiErrorDiagnostic {
  const rawMessage = errorMessage(error);
  const status = errorStatus(error, rawMessage);
  const code = providerCode(rawMessage, status);
  const category = error instanceof z.ZodError || error instanceof SyntaxError
    ? "invalid_response"
    : classify(status, code, rawMessage);
  const copy = descriptions[category];
  return {
    referenceId: `JRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    provider: "Gemini",
    category,
    status,
    code,
    title: copy.title,
    message: copy.message,
    technicalDetail: redactSecrets(rawMessage) || "Erro sem mensagem retornado pelo provedor.",
    occurredAt: now.toISOString(),
  };
}

export function readAiErrorDiagnostic(value: unknown): AiErrorDiagnostic | null {
  const parsed = aiErrorDiagnosticSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function formatAiErrorLog(diagnostic: AiErrorDiagnostic): string {
  return [
    `Referência: ${diagnostic.referenceId}`,
    `Provedor: ${diagnostic.provider}`,
    `Categoria: ${diagnostic.category}`,
    `HTTP: ${diagnostic.status ?? "não informado"}`,
    `Código: ${diagnostic.code}`,
    `Horário: ${diagnostic.occurredAt}`,
    `Detalhe técnico: ${diagnostic.technicalDetail}`,
  ].join("\n");
}
