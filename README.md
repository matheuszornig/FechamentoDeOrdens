# Fechamento de Ordens — apuração via API BTG Pactual

App web de **tela única** que consulta sob demanda a **API de notas de corretagem do BTG Pactual** e apura o resultado de operações de renda variável de uma conta em um período: informe **conta + data início + data fim** e o app busca as notas (respeitando o rate limit), processa o fechamento das operações e exibe **resultado fechado por ticker**, **custos por ticker** e **gráfico de evolução do P/L dia a dia**.

Fluxo 100% **Vercel + Neon** — sem ambiente local, sem Docker.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript strict** · Node.js 22 · pnpm
- **Tailwind CSS v4** + **shadcn/ui** · lucide-react · **Recharts** · **TanStack Table** · **TanStack Query** · React Hook Form + Zod
- **Drizzle ORM** + **PostgreSQL no Neon** (driver `@neondatabase/serverless` em todos os ambientes)
- **Better Auth** (um único usuário admin, e-mail/senha)
- **Biome** (lint/format) · **Vitest** (testes)
- Tudo em TypeScript — não houve necessidade de funções Python (nenhuma biblioteca de cálculo exclusiva foi necessária; o motor de apuração é aritmética simples).

## Como funciona

### 1. Filtro e validação

`conta` (apenas dígitos), `data_inicio` e `data_fim`, validados com Zod no formulário **e** no servidor:

- fim ≥ início;
- **fim ≤ D-1** — a API do BTG não publica o dia corrente (D-1 calculado no fuso `America/Sao_Paulo`);
- intervalo máximo de **12 meses**.

### 2. Job assíncrono com progresso

`POST /api/apuracao` cria um **ApuracaoJob** (status `pendente → buscando → calculando → concluido`, ou `erro`/`cancelado`) e dispara o processamento em background (`after()` do Next). O frontend faz **polling** de `GET /api/apuracao/[id]` a cada 2s (TanStack Query) e exibe a barra de progresso ("Buscando notas: 34/120 dias…"). Cancelamento via `PATCH { "action": "cancel" }`.

**Mecânica retomável** (limite de duração de funções na Vercel):

- As rotas de apuração declaram `maxDuration = 300` (máximo com fluid compute).
- Cada invocação processa por até `JOB_SLICE_BUDGET_MS` (padrão 250s) e para com folga, liberando o lock.
- O job tem um **lock com heartbeat** (`lockedAt`, renovado a cada data buscada). Se o polling encontra um job ativo com lock vencido (> 30s) — fatia esgotada ou função morta — ele **dispara a continuação de onde parou**.
- O estado no banco é a **fonte da verdade**: as datas já resolvidas ficam em `FetchedDate`, então a continuação nunca refaz trabalho.

### 3. Rate limit e cache

- A API do BTG permite **60 req/min**; o cliente usa um **rate limiter de janela deslizante com margem de segurança (50/min)** e retry com backoff exponencial em 429/5xx.
- Cada nota retornada é persistida (**payload bruto em jsonb** para auditoria + dados normalizados), e cada data consultada é marcada em `FetchedDate` com o desfecho (`com_notas`, `sem_notas` — o 404 "Não há valores publicados para esta data" **não é erro** —, `erro`). Repetir a consulta do mesmo período **não gasta rate limit de novo**.

### 4. Integração BTG (contrato real)

`src/lib/btg/` — `client.ts` (auth + notas), `schemas.ts` (Zod tolerante), `types.ts` (tipos internos), `mapper.ts`, `mock.ts`, atrás da interface única `BtgService`.

- **OAuth2**: `POST /iaas-auth/api/v1/authorization/oauth2/accesstoken` com `Basic base64(client_id:client_secret)` codificado em **latin1**, body form-urlencoded, headers `expires_in: 900` e `x-id-partner-request` (UUID v4 por requisição). **O token vem nos headers da resposta** (`access_token`, `x-id-pactual`, `Expires`), não no body. Cache em memória com renovação ~60s antes de expirar; 401 → renova e repete uma vez. TLS sempre validado.
- **Notas**: `POST /iaas-brokerage-notes/api/v1/brokerage-notes/account` com header próprio `access_token` (não `Authorization: Bearer`) e `x-id-partner-request` = **`x-id-pactual` devolvido junto com o token** (fluxo real observado; a doc sugeria UUID novo por requisição — fica como fallback); body `{ "date": "YYYY-MM-DD", "accountNumber": "..." }` — uma data por requisição (não existe consulta por intervalo, daí o job com uma requisição por dia útil). O `x-id-pactual` de cada resposta é logado para rastreabilidade junto ao BTG. O endpoint assíncrono de PDFs (`/derivative/account`) **não é usado**.

### 5. Motor de apuração (`src/lib/apuracao/`)

1. Compra+venda do mesmo ticker no mesmo pregão → quantidade casada é **day trade**; excedente vira posição (**swing**).
2. Swing com **preço médio ponderado**; vendas parciais fecham parcialmente; **short** suportado.
3. **Custos rateados** pro-rata ao valor financeiro de cada negócio; líquido = bruto − custos; **IRRF registrado à parte**.
4. **Futuros**: `tipoNegocio: "AJUPOS"` é ajuste diário de posição — fica **fora do matching** e entra como ajuste financeiro por mercadoria/dia; o resultado de futuros carregados é a soma dos ajustes (fechamentos swing de bmf não realizam resultado próprio, para não contar duas vezes). Day trades de futuros entram no matching normal. *Assunção documentada*: o valor do AJUPOS vem assinado; se vier absoluto, o lado `V` indica débito.
5. **Aluguel (loan)**: fora do matching, linha separada (remuneração − taxas − IRRF).
6. **Idempotente**: chave nº nota + conta + mercado — reprocessar não duplica.
7. **Validação cruzada** contra o `summarizedTradeList` de cada nota → alertas no job.
8. **Mercado fracionário**: ticker com sufixo `F` (ex.: `PETR4F`) é o mesmo papel do lote cheio (`PETR4`) com lote menor — o mapper (`stripFractionalSuffix`) junta os dois sob um único ticker antes de chegar ao motor, tanto nos negócios quanto no consolidado da nota (`summarizedTradeList`, somado por ticker para a validação cruzada não disparar falso alerta). Escopo: só no mercado à vista (bov) — séries de opção nunca têm esse sufixo.
9. Saída: resultado por ticker, custos por ticker/totais por categoria, série diária de P/L (com acumulado, ajustes e aluguel), posições em aberto, taxa de acerto.

Dias úteis = seg–sex; feriados não são modelados de propósito — a API responde 404 nesses dias e a data fica cacheada como vazia (mesmo efeito, sem tabela de feriados).

### 6. Mock (`BTG_USE_MOCK=true`)

Notas fictícias **no formato real do payload** (bov, option, bmf com AJUPOS, loan), **determinísticas por seed (conta+data)** — a mesma consulta devolve sempre as mesmas notas — incluindo ~30% de dias com **404 (sem notas)** e linhas-placeholder `"string"` para exercitar cache e mapper. Permite demonstrar o fluxo completo (barra de progresso, gráfico, tabelas) sem credenciais reais.

### 7. Exportação para Excel (teste e auditoria)

Com o job concluído, o botão **"Exportar Excel"** baixa um `.xlsx` (`GET /api/apuracao/[id]/export`, `src/lib/export/xlsx-export.ts`) com uma aba por dimensão dos dados, números crus (não formatados como moeda) para conferência e cálculo em planilha:

- **Resumo** — conta, período, totais e resumo do aluguel
- **Negócios** — uma linha por negócio de todas as notas do período (ticker, lado, quantidade, preço, valor bruto, day trade, vencimento, exercício de opção e papel-objeto)
- **Aluguel**, **Ajustes Futuros** (se houver AJUPOS), **Custos por Nota**
- **Resultado por Ticker**, **Custos por Ticker**, **Série Diária**, **Posições Abertas**, **Alertas** (as duas últimas só aparecem se não vazias)

As notas são **re-mapeadas do `rawPayload`** salvo no banco (a mesma fonte que o job usa para calcular) e passam pela mesma função de deduplicação do motor (`dedupeNotes`, regra 7 — nº nota + conta + mercado) antes de virar planilha. Isso é necessário porque `rawPayload` é a resposta **do dia inteiro**, replicada em toda linha de `brokerage_note` extraída daquele dia — sem esse dedup, a aba "Negócios" mostraria a mesma nota repetida uma vez por linha lida. O total de linhas da aba "Negócios" bate, célula a célula, com "Operações totais" da aba Resumo — a mesma garantia de consistência que a tela usa.

## Deploy na Vercel (Vercel-first, sem setup local)

1. **Crie o repositório no GitHub e conecte-o na Vercel** (Add New → Project). Preview em cada PR, produção na `main`.
2. **Integração Neon ↔ Vercel** (Storage → Neon): cria branch de banco por preview deployment e injeta `DATABASE_URL` por ambiente; produção usa o branch principal do Neon.
3. **Variáveis de ambiente** (ver `.env.example`):
   - `DATABASE_URL` — injetada pela integração Neon;
   - `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) e `BETTER_AUTH_URL` (URL pública do app);
   - `BTG_API_URL`, `BTG_CLIENT_ID`, `BTG_CLIENT_SECRET` — credenciais reais (apenas em Production);
   - `BTG_USE_MOCK` — **`true` em Preview, `false` em Production**;
   - opcional: `JOB_SLICE_BUDGET_MS`.
4. **Migrations automáticas no build**: `pnpm build` roda `drizzle-kit migrate` quando `DATABASE_URL` existe (`scripts/migrate.mjs`); em CI sem banco, o passo é pulado.
5. **Crie o admin**: rode o workflow manual **Seed admin** (Actions → Seed admin → Run workflow) com os secrets `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BETTER_AUTH_SECRET` configurados. Idempotente.

O primeiro push na `main` resulta em deploy funcional com `BTG_USE_MOCK=true`, banco migrado e admin criável via workflow.

### Para plugar as credenciais reais do BTG

Defina `BTG_CLIENT_ID`/`BTG_CLIENT_SECRET` no ambiente Production da Vercel e `BTG_USE_MOCK=false`. Nada mais muda — o `BtgService` real e o mock implementam a mesma interface.

## CI/CD (GitHub Actions)

- **`ci.yml`** — em PR e push na `main`: pnpm com cache → `pnpm lint` → `pnpm typecheck` → `pnpm test` (com Postgres 16 efêmero via `services`, exposto em `TEST_DATABASE_URL`) → `pnpm build`.
- **`seed.yml`** — manual, cria o usuário admin contra a `DATABASE_URL` informada.
- O deploy é feito pela **integração Git da Vercel** (não duplicado no Actions).
- **Branch protection** recomendada: em Settings → Branches → `main`, exija o status check **CI / ci** verde antes do merge.

## Modelo de dados

| Tabela | Papel |
| --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth (admin único) |
| `brokerage_note` | Nota persistida: dados normalizados + payload bruto (jsonb). Índice único (conta, data, mercado, nº nota). Funciona como cache. |
| `fetched_date` | Cache por (conta, data) com desfecho `com_notas`/`sem_notas`/`erro` — nunca repete requisição resolvida. |
| `apuracao_job` | Conta, período, status, progresso X/Y, resultado consolidado (jsonb), alertas, lock/heartbeat. |

Sem CRUD de clientes/operações — o app é somente consulta e cálculo.

## Segurança

- Todas as rotas (menos `/login` e `/api/auth`) protegidas por sessão (`proxy.ts` + validação server-side por rota).
- Credenciais BTG apenas em variáveis de ambiente do servidor; validação Zod em todo input.
- Rate limit próprio no endpoint de apuração: job ativo para a mesma conta+período é reaproveitado, nunca duplicado.

## Desenvolvimento

```bash
pnpm install
pnpm test        # Vitest (rate limiter, cliente BTG, mapper, motor, série diária)
pnpm lint        # Biome
pnpm typecheck   # tsc --noEmit
pnpm build       # migra (se DATABASE_URL) + next build
```

Para rodar o app é necessário um banco Neon (`DATABASE_URL`) — o fluxo suportado é deploy na Vercel com `BTG_USE_MOCK=true` em Preview.

## Decisões e versões

- Escopo completo registrado em `Panejamento.md`. Versões: Next 16.2, React 19.2, Zod 4, Drizzle 0.45, Better Auth 1.6, Recharts 3, TanStack Query 5/Table 8, Vitest 4, Biome 2.2 — estáveis mais recentes compatíveis na data do scaffold.
- shadcn/ui no estilo novo (base-nova, sobre Base UI) instalado via CLI; por isso o registry não tem o wrapper `form` — o formulário usa React Hook Form direto com `Input`/`Label`.
- Python não foi usado: nenhum ponto exigiu biblioteca indisponível em TS (critério do planejamento).
