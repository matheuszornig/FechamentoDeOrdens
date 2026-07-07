# Prompt para Claude Code — Apuração on-demand de resultados via API BTG

Copie tudo abaixo da linha e cole no Claude Code:

---

Crie um app web de **tela única** que consulta sob demanda a **API de notas de corretagem do BTG Pactual** e apura o resultado de operações de renda variável de uma conta em um período. Fluxo: o usuário informa **número da conta + data início + data fim** → o app busca as notas do período na API do BTG (respeitando o **rate limit de 60 requisições por minuto**) → processa o fechamento das operações → exibe **resultado fechado por ticker**, **custo total por ticker** e **gráfico de evolução do P/L dia a dia**. Deploy na **Vercel** com **CI/CD via GitHub Actions**, sem ambiente local.

## Stack obrigatória

- **Next.js 16** (App Router) com **React 19** e **TypeScript em strict mode**
- **Node.js 22 LTS**, gerenciador de pacotes **pnpm**
- **Tailwind CSS v4** + **shadcn/ui** (instalar via CLI do shadcn), **lucide-react** para ícones
- **Recharts** para o gráfico de P/L diário
- **TanStack Table** para as tabelas de resultado por ticker
- **TanStack Query** para o data fetching e polling de progresso
- **React Hook Form + Zod** para o formulário de filtro (validação de conta e intervalo de datas)
- **Drizzle ORM** com **PostgreSQL no Neon** (sem banco local, sem Docker): driver `@neondatabase/serverless` em todos os ambientes
- **Better Auth** com um único usuário admin (e-mail/senha) — o app consulta uma API com credenciais sensíveis e ficará público na Vercel, então uma tela de login simples é obrigatória
- **Biome** (lint + format), **Vitest** (testes), path alias `@/*`
- **Python é permitido se necessário** (Vercel suporta funções serverless Python): use apenas se houver justificativa concreta (ex.: alguma biblioteca de cálculo indisponível em TS). O padrão é implementar tudo em TypeScript; se optar por Python em algum ponto, isole como função serverless própria em `api/` e registre a justificativa no README

## Fluxo principal (núcleo do app)

1. Usuário preenche o filtro: `conta` (texto), `data_inicio`, `data_fim` (validar: fim ≥ início; **fim ≤ D-1** — a API do BTG não publica o dia corrente; limitar o intervalo máximo a 12 meses)
2. O backend monta a lista de **dias úteis** do intervalo e verifica no banco (cache) quais datas já têm notas buscadas para aquela conta
3. Para as datas faltantes, consulta a API do BTG **respeitando o rate limit de 60 req/min**:
   - Implementar um **token bucket / fila com `p-limit`** no cliente BTG: máx. 60 requisições por janela de 60s, com margem de segurança (usar 50/min), retry com backoff exponencial em erros 429/5xx
   - Persistir cada nota retornada (payload bruto em jsonb + dados normalizados) — o cache garante que repetir a consulta do mesmo período não gasta rate limit de novo
4. Como intervalos grandes podem levar minutos (ex.: 120 dias úteis ÷ 50 req/min), o processamento deve ser **assíncrono com progresso**:
   - `POST /api/apuracao` cria um **job** (registro `ApuracaoJob` no banco: conta, período, status `pendente/buscando/calculando/concluido/erro`, progresso X de Y datas, mensagem de erro) e dispara o processamento
   - O frontend faz **polling** do status via TanStack Query (`refetchInterval` de 2s) e exibe barra de progresso ("Buscando notas: 34/120 dias…")
   - Atenção ao limite de duração de funções na Vercel: configure `maxDuration` para o máximo do plano e **processe em lotes retomáveis** — se o job não terminar numa invocação, a próxima chamada de polling detecta job incompleto e dispara a continuação de onde parou (o estado do job no banco é a fonte da verdade). Documente essa mecânica no README
5. Com todas as notas do período disponíveis, rodar o **motor de apuração** e gravar o resultado consolidado no job (jsonb) para o frontend renderizar

## Integração BTG — contrato real do payload (resposta 200)

Crie o módulo `src/lib/btg/` com `client.ts` (auth OAuth2 conforme contrato abaixo, rate limiter, retry), `schemas.ts` (Zod tolerante, `.passthrough()`), `types.ts` (tipos internos desacoplados), `mapper.ts` e `mock.ts` (payloads no formato real, ativado por `BTG_USE_MOCK=true`), atrás de uma interface única `BtgService`.

### Autenticação OAuth2 (contrato real — implementar exatamente assim)

- Endpoint: `POST https://api.btgpactual.com/iaas-auth/api/v1/authorization/oauth2/accesstoken`
- `Authorization: Basic base64(client_id:client_secret)` — codificar o par em **ISO-8859-1/latin1** antes do base64
- Body `application/x-www-form-urlencoded`: `grant_type=client_credentials`, `client_id`, `client_secret`
- Headers da requisição: `expires_in: 900` e `x-id-partner-request` (identificador da requisição do parceiro — gerar um **UUID v4 por requisição**)
- **ATENÇÃO — comportamento incomum**: o token vem nos **headers da resposta**, não no body: `access_token`, `x-id-pactual` e `Expires` (validade). Ler de `response.headers`
- Token expira em **900s (15 min)**: implementar cache em memória com renovação automática ~60s antes de expirar; em 401, renovar e repetir uma vez
- Requisições subsequentes às notas devem enviar o `access_token` e o `x-id-partner-request`; propagar/registrar o `x-id-pactual` nos logs para rastreabilidade junto ao BTG
- **Nunca desabilitar validação TLS** (o script de referência usava `verify=False` — não replicar isso)

Implementação de referência em TypeScript (adaptar/integrar ao `client.ts`):

```typescript
type BtgToken = { accessToken: string; xIdPactual: string; expiresAt: number };

let cached: BtgToken | null = null;

export async function getBtgToken(): Promise<BtgToken> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached;

  const clientId = process.env.BTG_CLIENT_ID!;
  const clientSecret = process.env.BTG_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "latin1").toString("base64");

  const res = await fetch(
    "https://api.btgpactual.com/iaas-auth/api/v1/authorization/oauth2/accesstoken",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "expires_in": "900",
        "x-id-partner-request": crypto.randomUUID(),
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!res.ok) throw new Error(`Falha ao obter token BTG: ${res.status}`);

  // O BTG retorna o token nos HEADERS da resposta, não no body
  const accessToken = res.headers.get("access_token");
  const xIdPactual = res.headers.get("x-id-pactual") ?? "";
  if (!accessToken) throw new Error("Resposta OAuth sem header access_token");

  cached = { accessToken, xIdPactual, expiresAt: Date.now() + 900_000 };
  return cached;
}
```

Cobrir com testes (mockando `fetch`): leitura do token via headers, cache/renovação antes do vencimento e retry único em 401.

### Endpoint de notas (contrato OpenAPI real — implementar exatamente assim)

- `POST https://api.btgpactual.com/iaas-brokerage-notes/api/v1/brokerage-notes/account`
- Headers obrigatórios:
  - `access_token`: o token OAuth2 — **enviado como header próprio com esse nome**, NÃO como `Authorization: Bearer`
  - `x-id-partner-request`: **UUID v4 novo a cada requisição**, mesmo repetindo os mesmos parâmetros (exigência da doc)
- Body JSON: `{ "date": "YYYY-MM-DD", "accountNumber": "000000000" }` — **uma única data de referência por requisição** (não existe consulta por intervalo; por isso a mecânica de job com uma requisição por dia útil é obrigatória)
- Chamada síncrona; limite de **60 requisições por minuto**; janela de dados **D-X até D-1** — a API não retorna o dia corrente: validar no formulário que `data_fim ≤ ontem` (dia útil anterior)
- Respostas e semântica (tratar cada uma explicitamente):
  - **200**: JSON com as seções `loan`, `bmf`, `bov`, `option` (contrato detalhado abaixo); header `x-id-pactual` para rastreabilidade (logar)
  - **404** `"Não há valores publicados para esta data"`: **não é erro** — significa dia sem notas para a conta. Marcar a data como consultada e vazia no cache (`FetchedDate`) e seguir, sem retry
  - **401** token expirado: renovar token e repetir a requisição uma vez
  - **429/5xx**: retry com backoff exponencial; persistir falha definitiva no job com a data que falhou
- Existe um segundo endpoint (`/api/v1/brokerage-notes/derivative/account`) que é assíncrono via webhook e entrega **ZIP de PDFs** — **NÃO usar**; nosso fluxo usa exclusivamente o endpoint JSON acima

### Contrato do payload de notas (resposta 200)

A resposta traz quatro seções, cada uma um array de notas:

**`bov`** (ações à vista) e **`option`** (opções) — mesma estrutura:
- `ticketInfo`: `numeroNota`; `dataPregao`/`dataLiqui` em **DD/MM/YYYY** (converter); `numeroCliente`/`codCliente` (conta); `docCliente` (CPF/CNPJ com máscara — normalizar). Custos numéricos: `bolsaDataEmol` (emolumentos), `clearDataTaxaLiq` (taxa de liquidação), `clearDataTaxaReg` (registro), `correDataTotal` (corretagem), `correDataIss` (ISS), `correDataIrrf` (IRRF), `correDataTTA`, `pis`, `cofins`. Os campos `*Text` ("D"/"C") indicam débito/crédito — usar para normalizar sinais. Campos de day trade em **strings formatadas** (`corretDayTrade: "Corretagem: -R$ 3,00"`) — não usar para cálculo, apenas persistir no bruto
- `tradeList`: `cV` ("C"/"V") → lado; `specTitulo` → **ticker + especificação separados por `\t`** (`"AMER3\tON"` → `AMER3`); `quantidade`; `precoAjuste` (preço); `valorOperacao`; `tipoMercado`; `obs` (pode indicar day trade "D" — sinal auxiliar; o matching por pregão é a fonte da verdade)
- `summarizedTradeList`: consolidado por título — usar para **validação cruzada** do processamento (divergência → alerta no job)

**`bmf`** (futuros):
- `financialSummary`: custos com **sinal negativo** (`bmf_fee`, `registry_fee`, `operational_fee`, `iss`, `pis`, `cofins`, `cvm179_fee`, `total_fees`), `daytrade_adjustment`, `position_adjustment`, `total_net`
- `ticketInfo`: `numeroNota` (string), `dataPregao` DD/MM/YYYY, `codCliente`, e `tradeList` com `mercadoria` (ex.: `CCMF25`), `cV`, `dC` (**"D" = day trade, senão normal** — usar como sinal auxiliar de classificação no bmf), `quantidade`, `precoAjuste`, `valorOperacao`, `vencimento` (DD/MM/YYYY), `tipoNegocio`
- **Crítico**: `tipoNegocio: "AJUPOS"` é **ajuste diário de posição**, não abertura/fechamento — persistir como ajuste financeiro por mercadoria/dia, fora do matching. O resultado de futuros carregados = somatório dos ajustes diários; day trades de futuros entram no matching normal

**`loan`** (aluguel/BTC): `client` (`account_number`), `financial_summary`, `invoice_number` (**inteiro**, diferente dos demais mercados), `movement_date` (**ISO**), `movements[]` (`symbol`, `contract_side` Tomador/Doador, quantidades, `fee`, `remuneration`, `irrf`, datas ISO). **Fora do matching** — somar como linha separada de custos/remuneração no resultado do período

Normalizações obrigatórias (com testes): datas DD/MM/YYYY vs ISO → `Date`; custos sempre positivos internamente e resultados com sinal; split de `specTitulo` por `\t`; ignorar placeholders `"string"` sem falhar; persistir payload bruto (jsonb) para auditoria e reprocessamento.

## Motor de apuração (`src/lib/apuracao/` — testes extensivos)

1. Compra e venda do mesmo ticker no mesmo pregão → quantidade casada é **day trade**; excedente vai para posição (**swing**)
2. Posições swing: **preço médio ponderado**; vendas parciais fecham parcialmente
3. Suportar **short** (venda abre, compra fecha)
4. **Rateio de custos** da nota proporcional ao valor financeiro de cada negócio
5. Resultado bruto: `(preço saída − preço entrada) × quantidade` (invertido para short); líquido = bruto − custos rateados; registrar IRRF
6. Posições que permanecem abertas ao fim do período são listadas como "em aberto" (sem resultado realizado)
7. **Idempotente**: reprocessar as mesmas notas não duplica nada (chave: nº nota + conta + mercado)
8. Saída consolidada do job (o que a tela renderiza):
   - **Por ticker**: resultado líquido fechado no período, resultado bruto, custos totais rateados, nº de operações, quantidade negociada, modalidade predominante
   - **Custos do período por ticker e totais** (corretagem, emolumentos, liquidação, registro, ISS, PIS/COFINS, IRRF)
   - **Série diária de P/L**: resultado realizado por dia de pregão + acumulado (para o gráfico), incluindo ajustes de futuros e linha separada de aluguel
   - Alertas de validação cruzada e notas com erro

## A tela única

Rota protegida por login (Better Auth, um usuário admin criado via seed/variável de ambiente).

1. **Filtro no topo** (card): input de nº da conta, date pickers de início e fim (shadcn), botão "Apurar" — validação Zod inline
2. **Estado de progresso**: barra de progresso com etapas ("Buscando notas 34/120", "Calculando…"), cancelável
3. **Resultados** (após conclusão):
   - Cards de resumo: resultado líquido total do período, total de custos, nº de operações, taxa de acerto
   - **Gráfico (Recharts)**: evolução do P/L dia a dia — barras com o resultado diário e linha com o acumulado, tooltip em BRL
   - **Tabela "Resultado fechado por ticker"** (TanStack Table): ticker, modalidade, nº operações, resultado bruto, custos, resultado líquido, % do total — ordenável, com totalizador no rodapé
   - **Tabela "Custos por ticker"**: detalhamento por tipo de custo
   - Seção colapsável com posições ainda abertas ao fim do período e alertas/erros de processamento
4. UX: skeletons, estados vazios amigáveis, valores em BRL (`Intl.NumberFormat('pt-BR')`), positivos em verde e negativos em vermelho com sinal, tema claro/escuro, responsivo, toasts (sonner)

## Modelo de dados (Drizzle)

1. **User** — único admin (Better Auth)
2. **BrokerageNote** — conta, data do pregão, mercado (bov/option/bmf/loan), nº da nota, custos normalizados, payload bruto (jsonb), status. Índice único (conta + data + mercado + nº nota). Funciona como **cache**: datas já buscadas não vão de novo à API
3. **FetchedDate** — controle de cache por (conta + data): marca datas já consultadas na API com o desfecho (`com_notas`, `sem_notas` — resposta 404 —, `erro`), para nunca repetir requisições de datas já resolvidas
4. **ApuracaoJob** — conta, período, status, progresso, resultado consolidado (jsonb), alertas, timestamps
5. Sem CRUD de clientes/operações — o app é somente consulta e cálculo

## Segurança

- Todas as rotas (menos login) protegidas por sessão; credenciais BTG apenas em variáveis de ambiente do servidor
- Validação Zod em todo input; rate limit próprio no endpoint de apuração (evitar disparo de múltiplos jobs simultâneos da mesma conta — se já existe job ativo para conta+período, retornar o job existente)

## Deploy na Vercel (fluxo Vercel-first, sem ambiente local)

- Repositório GitHub conectado à Vercel: **preview em cada PR**, produção na `main`
- **Integração Neon ↔ Vercel**: branch de banco por preview deployment, `DATABASE_URL` injetada por ambiente; produção no branch principal
- Migrations automáticas no build (`drizzle-kit migrate` como etapa do script de build, condicionada à presença de `DATABASE_URL`)
- `BTG_USE_MOCK=true` em Preview, `false` em Production
- `maxDuration` configurado nas rotas de processamento; mecânica de job retomável documentada
- `.env.example` documentando: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BTG_API_URL`, `BTG_CLIENT_ID`, `BTG_CLIENT_SECRET`, `BTG_USE_MOCK`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (para o seed do usuário)

## CI/CD — GitHub Actions

- `.github/workflows/ci.yml`: dispara em PR e push na `main`; jobs com pnpm + cache → `pnpm lint` (Biome) → `pnpm typecheck` → `pnpm test` (Vitest, com Postgres efêmero via `services: postgres:16` dentro do runner) → `pnpm build`
- Deploy pela integração Git da Vercel (não duplicar no Actions); documentar branch protection da `main` condicionada ao CI verde
- `.github/workflows/seed.yml`: workflow manual que cria o usuário admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD` como secrets) contra a `DATABASE_URL` informada

## Entregáveis

1. Repositório pronto para conectar na Vercel: primeiro push na `main` resulta em deploy funcional com `BTG_USE_MOCK=true`, banco migrado e admin criável via workflow
2. Mock realista: gerar notas fictícias no formato real (bov, option, bmf com AJUPOS, loan) para qualquer conta/período consultado, determinísticas por seed (mesma consulta → mesmas notas), incluindo dias que retornam **404 (sem notas)** para exercitar o cache, permitindo demonstrar o fluxo completo com a barra de progresso
3. Testes Vitest: rate limiter (não excede 50/min, retoma após janela), cliente BTG (token via headers da resposta, renovação, `access_token` como header próprio, UUID novo por requisição, 404 tratado como dia vazio, retry em 429/5xx), mapper (datas, `specTitulo`, sinais D/C vs negativos, placeholders), motor de apuração (day trade casado, swing parcial, preço médio, short, rateio de custos, AJUPOS fora do matching, aluguel como linha separada, validação cruzada, idempotência), série diária de P/L
4. CI verde no GitHub Actions
5. README: fluxo Vercel-first (sem setup local), integração Neon, variáveis por ambiente, mecânica de jobs retomáveis e rate limit, como plugar as credenciais reais do BTG

## Instruções de execução

- Ordem: projeto base → Biome → Tailwind/shadcn → Drizzle + Neon → Better Auth → rate limiter + cliente BTG (mock primeiro) → mapper com testes → motor de apuração com testes → job assíncrono → tela → `vercel.json` → workflows → README
- Não criar `docker-compose.yml` nem instruções de banco local — fluxo 100% Vercel + Neon
- Commits pequenos e descritivos por etapa
- Ao final, rode `pnpm build`, `pnpm lint`, `pnpm typecheck` e `pnpm test` e corrija tudo antes de concluir
- Conflitos de versão: usar a estável mais recente compatível e registrar no README