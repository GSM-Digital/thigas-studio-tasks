# Thigas Plataforma

Sistema full-stack para tarefas, tempo e faturamento de agências. Construído com Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase e OpenAI Responses API.

## 1. Estrutura de pastas e arquivos

```text
app/
├── api/
│   ├── classify/route.ts             # avaliação isolada pelo Jarvis
│   ├── clients/                       # criar, editar e arquivar clientes
│   ├── cron/billing/route.ts          # disparo protegido/observabilidade do fechamento
│   ├── reports/route.ts               # relatório JSON ou CSV
│   ├── settings/route.ts              # valor por ponto
│   └── tasks/
│       ├── route.ts                   # criação + pontuação base
│       └── [taskId]/
│           ├── route.ts               # concluir/reabrir
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
├── ai/reevaluate-task.ts               # reavaliação ao concluir/corrigir tempo
├── domain/{points,time}.ts             # regras puras de domínio
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
- `tasks`: SLA, prazo de entrega (`due_at`), nível, pontos base, ajuste de eficiência, pontuação final, status e metadados do Jarvis;
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

`components/task-manager.tsx` contém a lista minimalista, checkboxes circulares, quick-add com SLA em horas e prazo de entrega com data/hora, filtro e gerenciador de clientes, cronômetro em tempo real, edição `HH:MM:SS`, valores em BRL, light/dark mode e layouts responsivos.

- **Desenvolvedor:** cria, conclui/reabre, inicia/para, corrige o tempo e exclui tarefas em aberto com confirmação.
- **Clientes:** o botão `+` ao lado de CLIENTES — ou “Gerenciar clientes” — abre o cadastro para adicionar, renomear, trocar a cor ou remover clientes.
- **Agência:** consulta o ciclo, totalizações e entregas por cliente; a única mutação disponível é aprovar uma entrega concluída.
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
  "bonus_ou_penalidade": "+0",
  "pontuacao_final": 10,
  "justificativa": "A configuração exige ferramentas externas e validação técnica. O tempo permaneceu dentro do SLA."
}
```

O Jarvis usa Structured Outputs com Zod, timeout de 12 s e duas tentativas de rede. O modelo define nível/pontos base e redige a justificativa; o servidor recalcula o fator de eficiência deterministicamente, impedindo divergências financeiras. Sem tempo real, a pontuação inicial é igual aos pontos base. Ao concluir a tarefa — ou corrigir o tempo de uma tarefa concluída — o Jarvis reavalia o resultado.

As faixas são: nível 1 = 1–4, nível 2 = 5–15, nível 3 = 20–35 e nível 4 = 50–100 pontos base. O bônus varia de +20% a +40%; atrasos recebem penalidade de -20% a -50%. A chave da OpenAI nunca é enviada ao navegador. O modelo padrão `gpt-5.4-nano` prioriza boa capacidade de classificação com baixo consumo; altere `OPENAI_CLASSIFICATION_MODEL` sem mudança de código.

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

Os testes cobrem faixas de pontos, todas as bandas de eficiência, aritmética monetária, parse/edição de tempo, timer ativo, Structured Outputs, normalização da resposta do Jarvis, inconsistência nível/pontos, contrato HTTP em português, limite de período, agrupamento e CSV.

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
- uma chave da OpenAI API com acesso ao modelo configurado.

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
| `OPENAI_API_KEY` | servidor | avaliação automática pelo Jarvis |
| `OPENAI_CLASSIFICATION_MODEL` | servidor | padrão `gpt-5.4-nano` |
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
- O fechamento é idempotente pela restrição única `(agency_id, period_start, period_end)`.
