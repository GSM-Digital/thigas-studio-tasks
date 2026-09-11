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
    const client = clientWith({
      acao: "criar_tarefa",
      resposta: "Entendi a demanda.",
      titulo: "Configurar GA4",
      descricao: "Validar todos os eventos no modo debug.",
      cliente_nome: "Make One",
      prazo_estimado_segundos: 7200,
      prazo_entrega_iso: "2030-04-18T15:00:00-03:00",
      nivel_complexidade: 2,
      pontos_base: 10,
      justificativa: "Configuração de ferramenta externa com validação de eventos e scripts.",
      campos_faltantes: [],
    });
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Configure o GA4 da Make One amanhã às 15h. Estimo 2 horas." }],
      clients,
      {
        now,
        model: "gemini-3.6-flash",
        client,
      },
    );

    expect(decision).toMatchObject({
      action: "create_task",
      task: {
        title: "Configurar GA4",
        description: "Validar todos os eventos no modo debug.",
        clientId: clients[0]!.id,
        clientName: "Make One",
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
    expect(client.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      operation: "jarvis_chat",
      maxOutputTokens: 520,
      prompt: expect.not.stringContaining(clients[0]!.id),
    }));
  });

  it("estima o tempo e pergunta apenas cliente e prazo quando eles faltam", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Preciso configurar o GA4." }],
      clients,
      {
        now,
        model: "gemini-3.6-flash",
        client: clientWith({
          acao: "perguntar",
          resposta: "Para qual cliente e até quando devo entregar? Informe data e hora.",
          titulo: "Configurar GA4",
          descricao: null,
          cliente_nome: null,
          prazo_estimado_segundos: null,
          prazo_entrega_iso: null,
          nivel_complexidade: null,
          pontos_base: null,
          justificativa: null,
          campos_faltantes: ["cliente", "prazo_entrega"],
        }),
      },
    );

    expect(decision).toEqual({
      action: "ask",
      message: "Para qual cliente e até quando devo entregar? Informe data e hora.",
      missingFields: ["cliente", "prazo_entrega"],
    });
  });

  it("aceita um cliente novo mencionado explicitamente e deixa o cadastro para a rota", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Implemente o formulário da LP da Full Body amanhã às 15h." }],
      clients,
      {
        now,
        model: "gemini-3.6-flash",
        client: clientWith({
          acao: "criar_tarefa",
          resposta: "Tudo pronto.",
          titulo: "Implementar formulário LP",
          descricao: null,
          cliente_nome: "Full Body",
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
        title: "Implementar formulário LP",
        clientId: null,
        clientName: "Full Body",
        estimatedDurationSeconds: 7200,
      },
    });
  });

  it("transforma uma demanda para agora em início imediato sem perguntar o prazo", async () => {
    const client = clientWith({
      acao: "perguntar",
      resposta: "Até quando essa demanda precisa ser entregue?",
      titulo: "Adicionar CNPJ, telefone e razão social nas três LPs",
      descricao: null,
      cliente_nome: "Chevrolet Auto Rio",
      prazo_estimado_segundos: 5400,
      prazo_entrega_iso: "2030-04-17T12:00:02.000Z",
      nivel_complexidade: 1,
      pontos_base: 4,
      justificativa: "Alteração de conteúdo repetida em três landing pages existentes.",
      campos_faltantes: ["prazo_entrega"],
    });

    const decision = await interpretJarvisConversation(
      [{
        role: "user",
        content: "Adicione CNPJ, telefone e razão social nas três LPs da Chevrolet Auto Rio. Vou fazer agora para agora.",
      }],
      clients,
      { now, model: "gemini-3.6-flash", client },
    );

    expect(decision).toMatchObject({
      action: "create_task",
      task: {
        clientName: "Chevrolet Auto Rio",
        estimatedDurationSeconds: 5400,
        dueAt: "2030-04-17T13:30:00.000Z",
      },
    });
    expect(client.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      systemInstruction: expect.stringContaining("Para agora"),
    }));
  });

  it("preserva um horário limite explícito mesmo quando o trabalho começa agora", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "É urgente, vou fazer agora e preciso terminar até 14h para a Make One." }],
      clients,
      {
        now,
        model: "gemini-3.6-flash",
        client: clientWith({
          acao: "criar_tarefa",
          resposta: "Entendi.",
          titulo: "Corrigir demanda urgente",
          descricao: null,
          cliente_nome: "Make One",
          prazo_estimado_segundos: 3600,
          prazo_entrega_iso: "2030-04-17T14:00:00.000Z",
          nivel_complexidade: 2,
          pontos_base: 8,
          justificativa: "Correção moderada que exige análise e validação.",
          campos_faltantes: [],
        }),
      },
    );

    expect(decision).toMatchObject({
      action: "create_task",
      task: { dueAt: "2030-04-17T14:00:00.000Z" },
    });
  });

  it("não confunde uma tarefa urgente para amanhã com início imediato", async () => {
    const decision = await interpretJarvisConversation(
      [{ role: "user", content: "Tenho uma tarefa urgente para amanhã da Make One." }],
      clients,
      {
        now,
        model: "gemini-3.6-flash",
        client: clientWith({
          acao: "perguntar",
          resposta: "Qual é o horário limite de amanhã?",
          titulo: "Executar tarefa urgente",
          descricao: null,
          cliente_nome: "Make One",
          prazo_estimado_segundos: 3600,
          prazo_entrega_iso: null,
          nivel_complexidade: 2,
          pontos_base: 8,
          justificativa: "Tarefa moderada que exige execução e validação.",
          campos_faltantes: ["prazo_entrega"],
        }),
      },
    );

    expect(decision).toEqual({
      action: "ask",
      message: "Qual é o horário limite de amanhã?",
      missingFields: ["prazo_entrega"],
    });
  });
});
