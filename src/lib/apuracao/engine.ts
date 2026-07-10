import type { InitialPosition, Market, NormalizedNote } from "@/lib/btg/types";
import type {
  AluguelSummary,
  ConsolidatedResult,
  CostBreakdown,
  DailyPoint,
  Modalidade,
  OpenPosition,
  TickerCosts,
  TickerResult,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

const COST_KEYS = [
  "corretagem",
  "emolumentos",
  "liquidacao",
  "registro",
  "iss",
  "pis",
  "cofins",
  "outros",
] as const;
type CostKey = (typeof COST_KEYS)[number];

const emptyBreakdown = (): CostBreakdown => ({
  corretagem: 0,
  emolumentos: 0,
  liquidacao: 0,
  registro: 0,
  iss: 0,
  pis: 0,
  cofins: 0,
  outros: 0,
  irrf: 0,
  total: 0,
});

/** Negócio com custos rateados pro-rata ao valor financeiro dentro da nota. */
interface TradeEvent {
  date: string;
  market: Market;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  grossValue: number;
  costs: Record<CostKey, number>;
  irrf: number;
}

/** Fechamento realizado. */
interface ClosedOperation {
  date: string;
  ticker: string;
  tipo: "day_trade" | "swing" | "exercicio" | "vencimento";
  quantidade: number;
  bruto: number;
}

/** Exercício pendente: fecha a série de opção a preço 0 na data do exercício. */
interface OptionClose {
  date: string;
  optionTicker: string;
  quantity: number;
}

interface PositionState {
  market: Market;
  qty: number; // >0 comprado, <0 vendido
  avgPrice: number;
}

interface TickerAccumulator {
  market: Market;
  operacoes: number;
  quantidade: number;
  bruto: number;
  ajustes: number;
  dayTradeQty: number;
  swingClosedQty: number;
  costs: CostBreakdown;
  /** Para preço médio de compra/venda (só negócios reais, não fechamentos a 0). */
  buyQty: number;
  buyValue: number;
  sellQty: number;
  sellValue: number;
}

/**
 * Motor de apuração de resultados.
 *
 * Regras (Panejamento.md):
 * 1. Compra+venda do mesmo ticker no mesmo pregão → quantidade casada é day
 *    trade; excedente vai para a posição (swing).
 * 2. Posições swing usam preço médio ponderado; vendas parciais fecham
 *    parcialmente.
 * 3. Short suportado (venda abre, compra fecha).
 * 4. Custos da nota rateados pro-rata ao valor financeiro de cada negócio.
 * 5. Bruto = (saída − entrada) × qtd (invertido no short); líquido = bruto −
 *    custos rateados; IRRF registrado à parte.
 * 6. Posições abertas ao fim do período são listadas sem resultado realizado.
 * 7. Idempotente: notas duplicadas (nº nota + conta + mercado) são ignoradas.
 * 8. Futuros: todo o financeiro entra pelo canal de ajustes por
 *    mercadoria/dia — a nota liquida cada linha (AJUPOS e negócios) contra o
 *    ajuste do dia, já em reais. O matching de bmf serve só à estatística
 *    (operações, quantidade fechada, PM, taxa de acerto); realizar por
 *    diferença de preço duplicaria e estaria em pontos.
 * 9. Aluguel (loan) fica fora do matching, como linha separada.
 * 10. Exercício de opções ("EXERC OPC *"): a linha vira um negócio em ações
 *     no papel-objeto ao strike, e a série exercida é fechada a preço 0 na
 *     data do exercício (o prêmio já está no preço médio da posição).
 * 11. Vencimento de opções: séries com posição aberta cujo vencimento
 *     (3ª sexta do `prazo`) cai dentro do período são fechadas a preço 0 na
 *     data do vencimento — prêmio virou resultado (ganho no short, perda no
 *     long).
 */
/**
 * (7) Idempotência: dedup por nº nota + conta + mercado, ordenado por data.
 *
 * Necessário mesmo fora do motor: `rawPayload` é armazenado por dia (a
 * resposta inteira da API), replicado em toda linha de `brokerage_note`
 * extraída daquele dia — recompor notas a partir de várias linhas do mesmo
 * dia sem dedup gera múltiplas cópias da mesma nota (uma por linha lida).
 * Usada pelo motor e pela exportação, para as duas verem os mesmos dados.
 */
export function dedupeNotes(notes: NormalizedNote[]): NormalizedNote[] {
  const seen = new Set<string>();
  const uniqueNotes: NormalizedNote[] = [];
  for (const note of notes) {
    const key = `${note.accountNumber}|${note.market}|${note.noteNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNotes.push(note);
  }
  uniqueNotes.sort((a, b) => a.date.localeCompare(b.date));
  return uniqueNotes;
}

export function apurar(
  notes: NormalizedNote[],
  opts: { endDate?: string; initialPositions?: InitialPosition[] } = {},
): ConsolidatedResult {
  const alertas: string[] = [];

  const uniqueNotes = dedupeNotes(notes);

  // (4) Rateio de custos + validação cruzada por nota.
  const events: TradeEvent[] = [];
  const optionCloses: OptionClose[] = [];
  const optionMaturities = new Map<string, string>();
  const custosTotais = emptyBreakdown();
  const dailyAdjustments = new Map<string, number>();
  const dailyLoan = new Map<string, number>();
  const tickerAdjustments = new Map<string, number>();
  const aluguel: AluguelSummary = {
    taxas: 0,
    remuneracao: 0,
    irrf: 0,
    liquido: 0,
  };

  for (const note of uniqueNotes) {
    for (const key of COST_KEYS) {
      custosTotais[key] += note.costs[key];
    }
    // Aluguel é fora do matching (regra 5): seu IRRF vive só em
    // `aluguel.irrf`, não em `custosTotais` — do contrário o rodapé da
    // tabela "Custos por Ticker" soma um IRRF que não pertence a nenhuma
    // linha de ticker (nenhum ticker "aluguel" existe em custosPorTicker).
    if (note.market !== "loan") {
      custosTotais.irrf += note.irrf;
    }

    for (const adj of note.adjustments) {
      dailyAdjustments.set(
        note.date,
        (dailyAdjustments.get(note.date) ?? 0) + adj.value,
      );
      tickerAdjustments.set(
        adj.ticker,
        (tickerAdjustments.get(adj.ticker) ?? 0) + adj.value,
      );
    }

    for (const line of note.loanLines) {
      aluguel.taxas += line.fee;
      aluguel.remuneracao += line.remuneration;
      aluguel.irrf += line.irrf;
      const net = line.remuneration - line.fee - line.irrf;
      dailyLoan.set(note.date, (dailyLoan.get(note.date) ?? 0) + net);
    }

    const noteGross = note.trades.reduce((acc, t) => acc + t.grossValue, 0);
    for (const trade of note.trades) {
      const fraction = noteGross > 0 ? trade.grossValue / noteGross : 0;
      const costs = {} as Record<CostKey, number>;
      for (const key of COST_KEYS) {
        costs[key] = note.costs[key] * fraction;
      }

      // (10) Exercício: perna em ações no papel-objeto + fechamento da série.
      if (trade.exercise) {
        optionCloses.push({
          date: note.date,
          optionTicker: trade.exercise.optionTicker,
          quantity: trade.quantity,
        });
        if (!trade.exercise.underlying) {
          alertas.push(
            `Nota ${note.noteNumber} (${note.date}): exercício de ${trade.exercise.optionTicker} sem papel-objeto derivável — perna em ações não contabilizada.`,
          );
          continue;
        }
        events.push({
          date: note.date,
          market: "bov",
          ticker: trade.exercise.underlying,
          side: trade.side,
          quantity: trade.quantity,
          price: trade.price, // strike
          grossValue: trade.grossValue,
          costs,
          irrf: note.irrf * fraction,
        });
        continue;
      }

      // (11) Vencimento conhecido da série de opção (3ª sexta do prazo).
      if (note.market === "option" && trade.maturity) {
        const key = `option|${trade.ticker}`;
        const current = optionMaturities.get(key);
        if (!current || trade.maturity > current) {
          optionMaturities.set(key, trade.maturity);
        }
      }

      events.push({
        date: note.date,
        market: note.market,
        ticker: trade.ticker,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        grossValue: trade.grossValue,
        costs,
        irrf: note.irrf * fraction,
      });
    }

    // Validação cruzada contra o consolidado da nota (summarizedTradeList).
    if (note.summary.length > 0) {
      const byTicker = new Map<string, number>();
      for (const t of note.trades) {
        byTicker.set(t.ticker, (byTicker.get(t.ticker) ?? 0) + t.quantity);
      }
      for (const s of note.summary) {
        const traded = byTicker.get(s.ticker) ?? 0;
        if (Math.abs(traded - s.quantity) > 0.0001) {
          alertas.push(
            `Nota ${note.noteNumber} (${note.date}, ${note.market}): quantidade de ${s.ticker} diverge do consolidado (negócios: ${traded}, consolidado: ${s.quantity}).`,
          );
        }
      }
    }
  }

  // Acumuladores.
  const tickers = new Map<string, TickerAccumulator>();
  const positions = new Map<string, PositionState>();
  const closedOps: ClosedOperation[] = [];
  // Razão diário por ticker (data → ticker → valor): a série do gráfico soma,
  // na consolidação, só os tickers fechados fora de futuros — mesma base do
  // card "Resultado líquido do período" e da tabela por ticker.
  const dailyByTicker = new Map<string, Map<string, number>>();

  const tickerKey = (market: Market, ticker: string) => `${market}|${ticker}`;
  const getAcc = (market: Market, ticker: string): TickerAccumulator => {
    const key = tickerKey(market, ticker);
    let acc = tickers.get(key);
    if (!acc) {
      acc = {
        market,
        operacoes: 0,
        quantidade: 0,
        bruto: 0,
        ajustes: 0,
        dayTradeQty: 0,
        swingClosedQty: 0,
        costs: emptyBreakdown(),
        buyQty: 0,
        buyValue: 0,
        sellQty: 0,
        sellValue: 0,
      };
      tickers.set(key, acc);
    }
    return acc;
  };

  const addDaily = (date: string, key: string, value: number) => {
    let day = dailyByTicker.get(date);
    if (!day) {
      day = new Map();
      dailyByTicker.set(date, day);
    }
    day.set(key, (day.get(key) ?? 0) + value);
  };

  // Posição inicial (D-1 do período, opcional): semeia o estado de posições
  // antes de processar os negócios — vendas subsequentes realizam contra o
  // preço médio da corretora, exercícios de séries abertas antes do período
  // deixam de alertar, e o que não for mexido aparece em posições abertas.
  // Não conta como negócio (operações/quantidade/PM ficam só com o período).
  for (const p of opts.initialPositions ?? []) {
    if (!p.ticker || p.quantity === 0) continue;
    const key = tickerKey(p.market, p.ticker);
    const current = positions.get(key);
    positions.set(key, {
      market: p.market,
      qty: (current?.qty ?? 0) + p.quantity,
      avgPrice: p.avgPrice,
    });
    // Vencimento derivado do ticker da série: só quando nenhuma nota do
    // período informou o prazo (a nota é a fonte autoritativa; o derivado é
    // heurística para série herdada de D-1 que não negociou no período —
    // sem isso ela nunca venceria dentro do período).
    if (p.market === "option" && p.maturity && !optionMaturities.has(key)) {
      optionMaturities.set(key, p.maturity);
    }
  }

  // Agrupa eventos por (data, mercado, ticker) preservando ordem cronológica.
  const byDate = new Map<string, Map<string, TradeEvent[]>>();
  for (const ev of events) {
    let dateGroup = byDate.get(ev.date);
    if (!dateGroup) {
      dateGroup = new Map();
      byDate.set(ev.date, dateGroup);
    }
    const key = tickerKey(ev.market, ev.ticker);
    const list = dateGroup.get(key) ?? [];
    list.push(ev);
    dateGroup.set(key, list);

    // Contabiliza negócio e custos do evento no ticker (independe de fechar).
    const acc = getAcc(ev.market, ev.ticker);
    acc.operacoes += 1;
    acc.quantidade += ev.quantity;
    if (ev.side === "buy") {
      acc.buyQty += ev.quantity;
      acc.buyValue += ev.grossValue;
    } else {
      acc.sellQty += ev.quantity;
      acc.sellValue += ev.grossValue;
    }
    for (const key2 of COST_KEYS) {
      acc.costs[key2] += ev.costs[key2];
    }
    acc.costs.irrf += ev.irrf;
    // Custos (com IRRF) entram na série diária no dia em que ocorrem — o
    // líquido por ticker também desconta o IRRF, e a série segue a mesma
    // definição. Futuros ficam fora da série realizada por completo: seu
    // financeiro vive no canal de ajustes e é exibido/somado à parte.
    if (ev.market !== "bmf") {
      addDaily(
        ev.date,
        key,
        -Object.values(ev.costs).reduce((a, b) => a + b, 0) - ev.irrf,
      );
    }
  }

  const sortedDates = [...byDate.keys()].sort();
  for (const date of sortedDates) {
    const dateGroup = byDate.get(date);
    if (!dateGroup) continue;
    for (const [key, dayEvents] of dateGroup) {
      const { market } = dayEvents[0];
      const ticker = dayEvents[0].ticker;
      const acc = getAcc(market, ticker);

      const buys = dayEvents.filter((e) => e.side === "buy");
      const sells = dayEvents.filter((e) => e.side === "sell");
      const buyQty = buys.reduce((a, e) => a + e.quantity, 0);
      const sellQty = sells.reduce((a, e) => a + e.quantity, 0);
      const matched = Math.min(buyQty, sellQty);

      // (1) Day trade: quantidade casada no próprio pregão.
      if (matched > 0) {
        const avgBuy =
          buys.reduce((a, e) => a + e.price * e.quantity, 0) / buyQty;
        const avgSell =
          sells.reduce((a, e) => a + e.price * e.quantity, 0) / sellQty;
        const bruto = matched * (avgSell - avgBuy);
        // (8) bmf: o financeiro do dia já entrou pelos ajustes (cada linha
        // da nota liquida contra o ajuste do dia) — realizar por diferença
        // de preço duplicaria, e estaria em pontos, não em reais. O matching
        // fica só como estatística; o sinal em pontos vale p/ taxa de acerto.
        if (market !== "bmf") {
          acc.bruto += bruto;
          addDaily(date, key, bruto);
        }
        acc.dayTradeQty += matched * 2;
        closedOps.push({
          date,
          ticker,
          tipo: "day_trade",
          quantidade: matched,
          bruto,
        });
      }

      // Excedente vai para a posição (swing), a preço médio do dia.
      const leftoverBuy = buyQty - matched;
      const leftoverSell = sellQty - matched;
      const posKey = key;
      const pos = positions.get(posKey) ?? { market, qty: 0, avgPrice: 0 };

      const applyToPosition = (
        side: "buy" | "sell",
        qty: number,
        price: number,
      ) => {
        if (qty <= 0) return;
        const signed = side === "buy" ? qty : -qty;

        if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
          // Abre/aumenta posição: preço médio ponderado. (2)
          const newQty = pos.qty + signed;
          pos.avgPrice =
            (Math.abs(pos.qty) * pos.avgPrice + qty * price) / Math.abs(newQty);
          pos.qty = newQty;
          return;
        }

        // Fecha (parcial ou total) posição contrária. (2)(3)
        const closeQty = Math.min(qty, Math.abs(pos.qty));
        const bruto =
          pos.qty > 0
            ? closeQty * (price - pos.avgPrice) // long fechado por venda
            : closeQty * (pos.avgPrice - price); // short fechado por compra

        // (8) bmf carregado: resultado vem dos ajustes diários — não realiza
        // financeiro por diferença de preço (só estatística de fechamento).
        if (market !== "bmf") {
          acc.bruto += bruto;
          addDaily(date, posKey, bruto);
        }
        acc.swingClosedQty += closeQty;
        closedOps.push({
          date,
          ticker,
          tipo: "swing",
          quantidade: closeQty,
          bruto,
        });

        pos.qty += pos.qty > 0 ? -closeQty : closeQty;
        const remainder = qty - closeQty;
        if (remainder > 0) {
          // Excedente inverte a posição.
          pos.qty = side === "buy" ? remainder : -remainder;
          pos.avgPrice = price;
        } else if (pos.qty === 0) {
          pos.avgPrice = 0;
        }
      };

      if (leftoverBuy > 0) {
        const avgBuy =
          buys.reduce((a, e) => a + e.price * e.quantity, 0) / buyQty;
        applyToPosition("buy", leftoverBuy, avgBuy);
      }
      if (leftoverSell > 0) {
        const avgSell =
          sells.reduce((a, e) => a + e.price * e.quantity, 0) / sellQty;
        applyToPosition("sell", leftoverSell, avgSell);
      }
      positions.set(posKey, pos);
    }
  }

  // (10)(11) Fechamento de séries de opção a preço 0. Uma série não negocia
  // após exercício/vencimento, então aplicar depois do loop principal é
  // seguro: a posição já está no estado final dos negócios.
  const closeOptionAtZero = (
    optionTicker: string,
    quantity: number | null,
    date: string,
    tipo: "exercicio" | "vencimento",
  ) => {
    const posKey = `option|${optionTicker}`;
    const pos = positions.get(posKey);
    if (!pos || pos.qty === 0) {
      if (tipo === "exercicio") {
        alertas.push(
          `Exercício de ${optionTicker} em ${date} sem posição correspondente no período (posição aberta antes do início?).`,
        );
      }
      return;
    }
    const closeQty = Math.min(quantity ?? Math.abs(pos.qty), Math.abs(pos.qty));
    // Prêmio realizado: short ganha o preço médio, long perde. (0 de saída)
    const bruto =
      pos.qty > 0 ? -closeQty * pos.avgPrice : closeQty * pos.avgPrice;
    const acc = getAcc("option", optionTicker);
    acc.bruto += bruto;
    acc.swingClosedQty += closeQty;
    closedOps.push({
      date,
      ticker: optionTicker,
      tipo,
      quantidade: closeQty,
      bruto,
    });
    addDaily(date, posKey, bruto);
    pos.qty += pos.qty > 0 ? -closeQty : closeQty;
    if (pos.qty === 0) pos.avgPrice = 0;
    positions.set(posKey, pos);
  };

  for (const close of [...optionCloses].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    closeOptionAtZero(
      close.optionTicker,
      close.quantity,
      close.date,
      "exercicio",
    );
  }

  // Séries ainda abertas cujo vencimento cai dentro do período.
  const endDate = opts.endDate ?? uniqueNotes.at(-1)?.date ?? "";
  for (const [posKey, pos] of positions) {
    if (pos.qty === 0 || pos.market !== "option") continue;
    const maturity = optionMaturities.get(posKey);
    if (maturity && maturity <= endDate) {
      closeOptionAtZero(posKey.split("|")[1], null, maturity, "vencimento");
    }
  }

  // Ajustes de futuros entram por mercadoria.
  for (const [ticker, value] of tickerAdjustments) {
    const acc = getAcc("bmf", ticker);
    acc.ajustes += value;
  }

  // ------------------------------------------------------------------
  // Consolidação
  // ------------------------------------------------------------------

  const porTicker: TickerResult[] = [];
  const custosPorTicker: TickerCosts[] = [];

  for (const [key, acc] of tickers) {
    const ticker = key.split("|")[1];
    const custosTotal = COST_KEYS.reduce((a, k) => a + acc.costs[k], 0);
    // "Custos" do ticker inclui o IRRF — mesma definição de
    // custosPorTicker[i].total, para as duas tabelas baterem por ticker.
    // Consequência: líquido = bruto − custos (com IRRF) por ticker, e não
    // mais "bruto − custosTotal" isolado (o IRRF passa a abater o líquido).
    const custosComIrrf = custosTotal + acc.costs.irrf;
    const liquido = acc.bruto + acc.ajustes - custosComIrrf;

    let modalidade: Modalidade;
    if (acc.dayTradeQty > 0 && acc.swingClosedQty > 0) modalidade = "mista";
    else if (acc.dayTradeQty > 0) modalidade = "day_trade";
    else if (acc.swingClosedQty > 0) modalidade = "swing";
    else modalidade = "posicao";

    porTicker.push({
      ticker,
      mercado: acc.market,
      modalidade,
      operacoes: acc.operacoes,
      quantidade: acc.quantidade,
      // dayTradeQty soma as duas pontas do casamento (compra+venda), por
      // isso divide por 2; swingClosedQty já é de uma ponta só (inclui
      // fechamentos de swing, exercício e vencimento — regra 10/11).
      quantidadeFechada: round2(acc.dayTradeQty / 2 + acc.swingClosedQty),
      precoMedioCompra:
        acc.buyQty > 0 ? round2(acc.buyValue / acc.buyQty) : null,
      precoMedioVenda:
        acc.sellQty > 0 ? round2(acc.sellValue / acc.sellQty) : null,
      resultadoBruto: round2(acc.bruto),
      ajustesFuturos: round2(acc.ajustes),
      custos: round2(custosComIrrf),
      irrf: round2(acc.costs.irrf),
      resultadoLiquido: round2(liquido),
    });

    custosPorTicker.push({
      ticker,
      corretagem: round2(acc.costs.corretagem),
      emolumentos: round2(acc.costs.emolumentos),
      liquidacao: round2(acc.costs.liquidacao),
      registro: round2(acc.costs.registro),
      iss: round2(acc.costs.iss),
      pis: round2(acc.costs.pis),
      cofins: round2(acc.costs.cofins),
      outros: round2(acc.costs.outros),
      irrf: round2(acc.costs.irrf),
      total: round2(custosComIrrf),
    });
  }
  porTicker.sort((a, b) => b.resultadoLiquido - a.resultadoLiquido);
  custosPorTicker.sort((a, b) => b.total - a.total);

  // (6) Posições em aberto.
  const posicoesAbertas: OpenPosition[] = [];
  for (const [key, pos] of positions) {
    if (pos.qty === 0) continue;
    posicoesAbertas.push({
      ticker: key.split("|")[1],
      mercado: pos.market,
      side: pos.qty > 0 ? "comprado" : "vendido",
      quantidade: Math.abs(pos.qty),
      precoMedio: round2(pos.avgPrice),
    });
  }
  posicoesAbertas.sort((a, b) => a.ticker.localeCompare(b.ticker));

  // Série diária de P/L: o `resultado` soma o razão diário só dos tickers
  // fechados fora de futuros — a mesma base de closed-totals (card do topo,
  // rodapé do resultado por ticker e gráfico); o acumulado final converge
  // para o "Resultado líquido do período". Custos de tickers que ficaram
  // só-abertos ficam de fora, como ficam do card.
  const fechadoKeys = new Set<string>();
  for (const [key, acc] of tickers) {
    const fechada = acc.dayTradeQty / 2 + acc.swingClosedQty;
    if (acc.market !== "bmf" && fechada !== 0) fechadoKeys.add(key);
  }

  const allDates = new Set<string>([
    ...dailyByTicker.keys(),
    ...dailyAdjustments.keys(),
    ...dailyLoan.keys(),
  ]);
  const serieDiaria: DailyPoint[] = [];
  let acumulado = 0;
  for (const date of [...allDates].sort()) {
    let resultado = 0;
    for (const [key, value] of dailyByTicker.get(date) ?? []) {
      if (fechadoKeys.has(key)) resultado += value;
    }
    const ajustes = dailyAdjustments.get(date) ?? 0;
    const aluguelDia = dailyLoan.get(date) ?? 0;
    const total = resultado + ajustes + aluguelDia;
    acumulado += total;
    serieDiaria.push({
      date,
      resultado: round2(resultado),
      ajustesFuturos: round2(ajustes),
      aluguel: round2(aluguelDia),
      total: round2(total),
      acumulado: round2(acumulado),
    });
  }

  aluguel.liquido = aluguel.remuneracao - aluguel.taxas - aluguel.irrf;

  const totalCustos = COST_KEYS.reduce((a, k) => a + custosTotais[k], 0);
  const resultadoBruto = porTicker.reduce(
    (a, t) => a + t.resultadoBruto + t.ajustesFuturos,
    0,
  );
  const resultadoLiquido =
    porTicker.reduce((a, t) => a + t.resultadoLiquido, 0) + aluguel.liquido;
  const wins = closedOps.filter((op) => op.bruto > 0).length;

  const result: ConsolidatedResult = {
    porTicker,
    custosPorTicker,
    custosTotais: {
      corretagem: round2(custosTotais.corretagem),
      emolumentos: round2(custosTotais.emolumentos),
      liquidacao: round2(custosTotais.liquidacao),
      registro: round2(custosTotais.registro),
      iss: round2(custosTotais.iss),
      pis: round2(custosTotais.pis),
      cofins: round2(custosTotais.cofins),
      outros: round2(custosTotais.outros),
      irrf: round2(custosTotais.irrf),
      total: round2(totalCustos + custosTotais.irrf),
    },
    serieDiaria,
    posicoesAbertas,
    aluguel: {
      taxas: round2(aluguel.taxas),
      remuneracao: round2(aluguel.remuneracao),
      irrf: round2(aluguel.irrf),
      liquido: round2(aluguel.liquido),
    },
    totais: {
      resultadoLiquido: round2(resultadoLiquido),
      resultadoBruto: round2(resultadoBruto),
      // Inclui o IRRF (trading) — mesma definição de custosTotais.total, para
      // "Custos totais" do período bater com o rodapé de "Custos por Ticker".
      custos: round2(totalCustos + custosTotais.irrf),
      irrf: round2(custosTotais.irrf),
      operacoes: events.length,
      operacoesFechadas: closedOps.length,
      taxaAcerto:
        closedOps.length > 0 ? round2((wins / closedOps.length) * 100) : 0,
    },
    alertas,
  };

  return result;
}
