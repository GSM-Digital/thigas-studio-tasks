import { describe, expect, it, vi } from "vitest";
import {
  interpretJarvisConversation,
  type JarvisChatClient,
} from "@/lib/ai/jarvis-chat";

const clients = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Make One", color: "#007CFF" },
];
const now = new Date("2030-04-17T12:00:00.000Z");

function clientWith(output: Record<string, unknown>): JarvisChatClient {
  return { generateStructured: vi.fn().mockResolvedValue(output) };
}

describe("conversa do Jarvis", () => {
  it("prepara uma tarefa completa com classificação validada", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Configure o GA4 da Make One amanhã às 15h. Estimo 2 horas." }],
      clients,
      {
        now,
        model: "gemini-2.5-flash",
        client: clientWith({
          acao: "criar_tarefa",
          resposta: "Entendi a demanda.",
          titulo: "Configurar GA4",
          cliente_id: clients[0]!.id,
          prazo_estimado_segundos: 7200,
          prazo_entrega_iso: "2030-04-18T15:00:00-03:00",
          nivel_complexidade: 2,
          pontos_base: 10,
          justificativa: "Configuração de ferramenta externa com validação de eventos e scripts.",
          campos_faltantes: [],
        }),
      },
    );

    expect(decision).toMatchObject({
      action: "create_task",
      task: {
        title: "Configurar GA4",
        clientId: clients[0]!.id,
        estimatedDurationSeconds: 7200,
        dueAt: "2030-04-18T18:00:00.000Z",
        classification: {
          complexityLevel: 2,
          basePoints: 10,
          efficiencyAdjustment: 0,
          finalPoints: 10,
        },
      },
    });
  });

  it("pergunta somente quando faltam dados", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Preciso configurar o GA4." }],
      clients,
      {
        now,
        model: "gemini-2.5-flash",
        client: clientWith({
          acao: "perguntar",
          resposta: "Para qual cliente e qual é a estimativa e o prazo de entrega?",
          titulo: "Configurar GA4",
          cliente_id: null,
          prazo_estimado_segundos: null,
          prazo_entrega_iso: null,
          nivel_complexidade: null,
          pontos_base: null,
          justificativa: null,
          campos_faltantes: ["cliente", "prazo_estimado", "prazo_entrega"],
        }),
      },
    );

    expect(decision).toEqual({
      action: "ask",
      message: "Para qual cliente e qual é a estimativa e o prazo de entrega?",
      missingFields: ["cliente", "prazo_estimado", "prazo_entrega"],
    });
  });

  it("não aceita cliente inventado pelo modelo", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Crie a demanda completa." }],
      clients,
      {
        now,
        model: "gemini-2.5-flash",
        client: clientWith({
          acao: "criar_tarefa",
          resposta: "Tudo pronto.",
          titulo: "Configurar GA4",
          cliente_id: "99999999-9999-4999-8999-999999999999",
          prazo_estimado_segundos: 7200,
          prazo_entrega_iso: "2030-04-18T15:00:00-03:00",
          nivel_complexidade: 2,
          pontos_base: 10,
          justificativa: "Configuração de ferramenta externa com validação de eventos e scripts.",
          campos_faltantes: [],
        }),
      },
    );

    expect(decision.action).toBe("ask");
  });
});
