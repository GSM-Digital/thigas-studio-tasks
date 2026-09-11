# Thigas Plataforma

Sistema full-stack para tarefas, tempo e faturamento de agências. Construído com Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase e Gemini Developer API.

## 1. Estrutura de pastas e arquivos

```text
app/
├── api/
│   ├── classify/route.ts             # avaliação isolada pelo Jarvis
│   ├── jarvis/chat/route.ts           # conversa que coleta e cria demandas
│   ├── clients/                       # criar, editar e arquivar clientes
│   ├── cron/billing/route.ts          # disparo protegido/observabilidade do fechamento
│   ├── reports/route.ts               # relatório JSON ou CSV
│   ├── settings/route.ts              # valor por ponto
│   └── tasks/
│       ├── route.ts                   # criação + pontuação base
│       └── [taskId]/
│           ├── route.ts               # concluir/reabrir e editar observações
│           ├── approval/route.ts       # aprovação exclusiva da agência
│           ├── time/route.ts           # ajuste manual auditável
│           └── timer/route.ts          # play/stop atômicos
├── auth/callback/route.ts              # callback PKCE do Supabase Auth
├── login/page.tsx
├── globals.css                         # Tailwind + design system iOS-like
├── layout.tsx
└── page.tsx
components/
├── login-form.tsx
└── task-manager.tsx                    # UI principal e as duas visões
lib/
├── ai/classifier.ts                    # prompt/Structured Output do Jarvis
├── ai/completion-evaluator.ts          # bônus/penalidade pelo relato de execução
├── ai/jarvis-chat.ts                   # interpretação conversacional validada
├── ai/reevaluate-task.ts               # reavaliação ao concluir/corrigir tempo
├── clients/resolve.ts                  # encontra ou cria clientes com proteção contra duplicidade
├── domain/{client,points,time}.ts      # regras puras de domínio
├── reports/generate.ts                 # agrupamento e totalização
├── supabase/{browser,server,proxy}.ts  # clientes SSR/cookies
├── auth.ts, env.ts, http.ts             # segurança, ambiente e erros
├── database.types.ts, types.ts          # contratos TypeScript
└── workspace.ts, task-view.ts           # camada de leitura
supabase/
├── migrations/*.sql                    # schema inicial + scoring do Jarvis
├── config.toml
└── seed.sql
tests/
├── classifier.test.ts
├── classify-route.integration.test.ts
├── points.test.ts
├── report.test.ts
└── time.test.ts
proxy.ts                                 # renovação da sessão Supabase
```

## 2. Schema do banco de dados

A migration em `supabase/migrations/` cria:

- `agencies`: tenant, moeda, fuso horário e valor vigente por ponto;
- `profiles`: extensão de `auth.users`, com papéis `developer` e `agency`;
- `clients`: clientes pertencentes à agência;
- `tasks`: título, descrição/observações, relato de conclusão, tempo previsto, prazo de entrega (`due_at`), nível, pontos base, ajustes de eficiência/execução, pontuação final, status e metadados do Jarvis;
- `task_suggestions`: checklist gamificado por tarefa, bônus possível, desconto por item essencial ignorado, comprovação e verificação final do Jarvis;
- `time_entries`: sessões imutáveis de cronômetro;
- `task_time_adjustments`: trilha de auditoria da edição manual;
- `billing_cycles` e `billing_items`: snapshot financeiro imutável de cada fechamento.

Todas as tabelas públicas usam RLS. O tenant vem de `app_metadata.agency_id` — nunca de `user_metadata`. Os índices cobrem chaves estrangeiras, filtros de status/período e garantem no máximo um timer ativo por tarefa e por usuário.

As funções `start_task_timer` e `stop_task_timer` fazem locking e atualização atômicos. `approve_task` permite à agência somente a transição de `completed` para `approved`. A função idempotente `generate_monthly_billing_cycles` cria snapshots do período anterior.

O Supabase Cron executa às 06:00 UTC (03:00 em São Paulo) no dia 15:

```sql
select cron.schedule(
  'generate-billing-cycles-day-15',
  '0 6 15 * *',
  $$select public.generate_monthly_billing_cycles(current_date);$$
);
```

## 3. Componente principal da UI

`components/task-manager.tsx` contém a lista minimalista, seletores circulares, inclusão rápida com descrição/observações, tempo previsto opcional em horas e prazo de entrega com data/hora, filtro e gerenciador de clientes, cronômetro em tempo real, edição `HH:MM:SS`, valores em reais, modos claro e escuro e layouts responsivos. Quando o tempo previsto fica vazio, o Jarvis estima a duração média em incrementos de 15 minutos antes de salvar a demanda; qualquer valor digitado pelo usuário tem prioridade. As observações podem ser editadas diretamente no card.

Cada demanda tem a aba **Sugestões do Jarvis**. A primeira abertura gera de três a seis recomendações específicas; as próximas aberturas usam o conteúdo já salvo para economizar chamadas da API. O desenvolvedor pode marcar o que realizou, registrar uma comprovação ou explicar por que um item não se aplica. Itens opcionais podem gerar bônus; somente itens identificados como essenciais podem gerar desconto quando ignorados. O total positivo do checklist é limitado a 20%.

Ao concluir a demanda, o mesmo checklist aparece para revisão. O Jarvis compara o relato e as comprovações, confirma ou rejeita cada item e o sistema calcula os pontos de forma determinística. O uso de inteligência artificial ou automação não reduz pontos por si só: autoria, revisão e validação continuam sendo os critérios. A interface e os textos gerados priorizam português simples; termos técnicos inevitáveis são explicados na primeira ocorrência.

- **Desenvolvedor:** cria, conclui/reabre, inicia/para, corrige o tempo, troca o cliente ou o prazo diretamente no card e exclui tarefas em aberto com confirmação. Ao concluir, um modal obrigatório registra como foi a execução; se o timer estiver ativo, ele é parado antes do preenchimento. Enquanto houver qualquer cronômetro ativo, o favicon muda para um círculo vermelho e volta ao ícone normal ao parar o último timer.
- **Prioridade inteligente:** as pendências são ordenadas pelo último momento seguro para começar (`prazo − duração estimada ajustada ao risco`). A margem adicional é de 0% no nível 1, 15% no nível 2, 30% no nível 3 e 50% no nível 4. Ao editar o prazo, a lista é recalculada e reordenada imediatamente. Prazos ausentes ou inválidos ficam no fim.
- **Clientes:** o botão `+` ao lado de CLIENTES — ou “Gerenciar clientes” — abre o cadastro para adicionar, renomear, trocar a cor ou remover clientes.
- **Agência:** consulta o ciclo, totalizações e entregas por cliente; a única mutação disponível é aprovar uma entrega concluída.
- **Jarvis:** o botão no cabeçalho abre um chat que transforma uma solicitação em tarefa. O compositor aceita digitação ou ditado por microfone em português nos navegadores compatíveis, mantendo a transcrição editável antes do envio. Ele estima o tempo quando necessário e cadastra automaticamente um cliente explicitamente mencionado que ainda não exista. O prazo de entrega nunca é inventado: se faltar data ou hora, ele pergunta ao usuário.
- **PDF:** o botão “Salvar PDF” aplica uma folha de impressão dedicada e abre o diálogo nativo do navegador.
- **Tabela:** exportação CSV UTF-8 com separador compatível com Excel pt-BR.

Sem variáveis de Supabase, a aplicação abre automaticamente em modo demonstração. Em produção, defina `NEXT_PUBLIC_DEMO_MODE=false`.

A remoção de clientes é um arquivamento (`active = false`): o cliente deixa de aparecer em filtros e novas tarefas, enquanto entregas e faturamentos históricos continuam íntegros. Nomes são únicos apenas entre clientes ativos, permitindo recadastrar posteriormente um cliente arquivado.

Tarefas em aberto podem ser excluídas pelo botão de lixeira no card. A ação exige dois cliques, não é permitida enquanto o cronômetro está rodando e nunca fica disponível para tarefas concluídas ou aprovadas.

## 4. Jarvis — avaliação por IA

`POST /api/classify`

```json
{
  "tarefa": "Configurar o GA4 para o cliente Make One",
  "prazo_estimado_segundos": 7200,
  "tempo_real_gasto_segundos": 3600
}
```

Resposta:

```json
{
  "nivel_complexidade": 2,
  "pontos_base": 10,
  "cliente_nome": "Make One",
  "prazo_estimado_segundos": 7200,
  "bonus_ou_penalidade": "+0",
  "pontuacao_final": 10,
  "justificativa": "A configuração exige ferramentas externas e validação técnica. O tempo permaneceu dentro do SLA."
}
```

O Jarvis usa saída JSON estruturada do Gemini, validação com Zod, timeout de 12 s e até duas novas tentativas para falhas transitórias. O modelo define nível/pontos base e redige a justificativa; o servidor recalcula o fator de eficiência deterministicamente, impedindo divergências financeiras. Sem tempo real, a pontuação inicial é igual aos pontos base. Ao concluir, o relato fica salvo para consulta futura e passa por uma segunda rubrica: o Jarvis avalia autoria, qualidade, cumprimento do escopo e retrabalho, enquanto o servidor transforma o percentual permitido em pontos.

Falhas da IA são classificadas em cota/créditos esgotados, limite momentâneo de requisições, faturamento pendente, autenticação, modelo inexistente, requisição ou resposta inválida, timeout, rede, indisponibilidade e causa desconhecida. O diagnóstico sanitizado é salvo em `classification_metadata.last_evaluation_error` com referência única, status HTTP e código do provedor. A interface permite copiar esse log sem expor chaves ou tokens.

Para reduzir consumo sem trocar o modelo, o Jarvis envia ao Gemini somente os campos que exigem julgamento semântico. Bônus de eficiência e pontuação final são calculados localmente, UUIDs de clientes não entram no prompt, mensagens de interface e falhas são removidas do histórico, e cada fluxo possui um limite de saída calibrado. Quando o provedor devolve `usageMetadata`, a Vercel registra `promptTokens`, `outputTokens`, `thoughtTokens`, `cachedTokens` e `totalTokens` por operação, sem registrar o conteúdo das demandas.

O chat usa `POST /api/jarvis/chat`. A conversa recente é enviada sem a chave da API sair do servidor. Quando os três dados obrigatórios — tarefa, cliente identificável e data/hora de entrega — estão completos, o servidor valida a saída estruturada, estima o SLA ausente, encontra ou cadastra o cliente e grava a tarefa no Supabase. Expressões como “para agora” e “vou fazer agora” representam início imediato: o prazo operacional é calculado como o horário atual somado ao SLA estimado, sem nova pergunta; um horário limite explícito sempre prevalece. Nomes novos só são aceitos quando aparecem explicitamente na demanda; duplicidades por caixa/espaços e criações concorrentes são tratadas antes da persistência. Falhas do Gemini também são classificadas no próprio chat, com mensagem específica, status HTTP, código do provedor, referência e diagnóstico sanitizado copiável.

As sugestões do Jarvis aprendem com o histórico de uso da própria agência. Uma sugestão marcada como “Não se aplica” e sua justificativa viram um sinal de cautela; quando o mesmo tema é dispensado pelo menos duas vezes em tarefas realmente semelhantes e representa ao menos dois terços dos sinais daquele contexto, ele deixa de ser sugerido. Itens realizados funcionam como contrapeso. O histórico é limitado aos registros recentes e relevantes, evitando aumento desnecessário de tokens e impedindo que preferências de uma agência sejam usadas em outra.

As faixas são: nível 1 = 1–4, nível 2 = 5–15, nível 3 = 20–35 e nível 4 = 50–100 pontos base. O ajuste de tempo varia de +20% a +40%; atrasos recebem penalidade de -20% a -50%. Separadamente, o relato pode gerar ajuste de execução entre -100% e +20%: pequenas falhas começam em -10%, entregas incompletas ou com retrabalho variam de -20% a -40%, requisitos ignorados de -30% a -50%, execução majoritária por terceiros de -50% a -80% e ausência de execução pelo desenvolvedor recebe -100%. Imprevistos externos e riscos relevantes efetivamente resolvidos podem gerar +5% a +20%. O uso responsável de IA, automação ou ferramentas é neutro; se houver penalidade de execução, qualquer bônus positivo de velocidade é suprimido. A pontuação final nunca fica abaixo de zero. A chave do Gemini nunca é enviada ao navegador. O modelo `gemini-3.6-flash`, com raciocínio mínimo, foi escolhido pelo equilíbrio entre qualidade, baixa latência e custo. Se a cota dele acabar, o Jarvis refaz a solicitação no `gemini-3.5-flash` e usa esse modelo de reserva por 24 horas. Depois, testa e recupera automaticamente o principal. O estado fica persistido no Supabase para valer em todas as instâncias da Vercel.

## 5. Gerador de relatórios

`lib/reports/generate.ts` é uma função pura: filtra o intervalo semiaberto `[início, fim)`, usa o ajuste manual quando presente, agrupa por cliente, totaliza pontos/centavos/segundos e ordena a saída. Valores monetários permanecem em centavos, evitando erros de ponto flutuante.

`GET /api/reports?periodStart=<ISO>&periodEnd=<ISO>&format=json|csv` gera a visão sob demanda. O fechamento automático usa o valor por ponto capturado no dia do ciclo, preservando o histórico mesmo após mudanças em Ajustes.

## 6. Testes

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Os testes cobrem faixas de pontos, todas as bandas de eficiência, bônus e penalidades do relato de conclusão, modal de fechamento, aritmética monetária, parse/edição de tempo, observações, timer ativo, Structured Outputs, conversa do Jarvis, resolução/criação automática de clientes, criação de tarefa pelo chat, contrato HTTP em português, limite de período, agrupamento e CSV.

Para validar o schema localmente, tenha Docker ativo e execute:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

## 7. Setup e uso

### Pré-requisitos

- Node.js 22.13 ou superior;
- Docker Desktop para Supabase local, ou um projeto hospedado;
- uma chave da Gemini Developer API com acesso ao modelo configurado.

### Instalação

```bash
npm install
cp .env.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

Abra `http://localhost:3000`.

### Variáveis de ambiente

| Variável | Exposição | Uso |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador | URL do projeto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | navegador | chave publicável, protegida por RLS |
| `SUPABASE_SECRET_KEY` | servidor | execução manual do fechamento; nunca use `NEXT_PUBLIC_` |
| `GEMINI_API_KEY` | servidor | avaliação automática pelo Jarvis; nunca use `NEXT_PUBLIC_` |
| `GEMINI_CLASSIFICATION_MODEL` | servidor | padrão `gemini-3.6-flash` |
| `GEMINI_FALLBACK_MODEL` | servidor | modelo de reserva; padrão `gemini-3.5-flash` |
| `GEMINI_FALLBACK_COOLDOWN_HOURS` | servidor | horas antes de testar novamente o principal; padrão `24` |
| `CRON_SECRET` | servidor | bearer token de no mínimo 32 caracteres |
| `NEXT_PUBLIC_DEMO_MODE` | navegador | `true` somente para demonstração local |

### Provisionamento de usuários

1. Crie a agência e os clientes (o `seed.sql` oferece dados locais).
2. Convide o usuário pelo Supabase Auth.
3. Pelo servidor/Admin API, grave `app_metadata` (não `user_metadata`):

```json
{ "agency_id": "UUID_DA_AGENCIA", "role": "developer" }
```

4. Crie o perfil correspondente com os mesmos tenant e papel:

```sql
insert into public.profiles (id, agency_id, full_name, role)
values ('UUID_DO_AUTH_USER', 'UUID_DA_AGENCIA', 'Nome da pessoa', 'developer');
```

Use `role = 'agency'` para o cliente aprovador. Após alterar `app_metadata`, encerre as sessões existentes ou renove o token para que as claims sejam atualizadas.

### Deploy

1. Aplique a migration com `npx supabase db push` após vincular o projeto.
2. Configure as variáveis no provedor do Next.js.
3. Execute `npm run build` no pipeline.
4. Confirme o job em **Supabase Dashboard → Integrations → Cron** e acompanhe `cron.job_run_details`.
5. Mantenha a rota `/api/cron/billing` apenas para reexecução operacional protegida; o agendamento principal roda dentro do Postgres e não depende do uptime do frontend.

### Tratamento de falhas

- Erros de entrada retornam `400` com código estável e detalhes por campo.
- Falta de sessão/papel retorna `401/403`.
- Conflitos de timer e estado retornam `409`.
- Falhas inesperadas não expõem stack trace nem segredos ao cliente.
- Falhas do Jarvis exibem categoria, referência e diagnóstico copiável; segredos são removidos antes do log ser persistido.
- O fechamento é idempotente pela restrição única `(agency_id, period_start, period_end)`.
