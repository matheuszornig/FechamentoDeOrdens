import type { Market, NormalizedNote } from "@/lib/btg/types";
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

/** Fechamento realizado (day trade casado ou fechamento swing). */
interface ClosedOperation {
  date: string;
  ticker: string;
  tipo: "day_trade" | "swing";
  quantidade: number;
  bruto: number;
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
 * 8. Futuros: AJUPOS fica fora do matching e entra como ajuste financeiro por
 *    mercadoria/dia; o resultado de futuros carregados é a soma dos ajustes —
 *    por isso fechamentos swing de bmf não geram resultado realizado próprio
 *    (evita dupla contagem), apenas atualizam a posição. Day trades de
 *    futuros entram no matching normal.
 * 9. Aluguel (loan) fica fora do matching, como linha separada.
 */
export function apurar(notes: NormalizedNote[]): ConsolidatedResult {
  const alertas: string[] = [];

  // (7) Idempotência: dedup por nº nota + conta + mercado.
  const seen = new Set<string>();
  const uniqueNotes: NormalizedNote[] = [];
  for (const note of notes) {
    const key = `${note.accountNumber}|${note.market}|${note.noteNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNotes.push(note);
  }
  uniqueNotes.sort((a, b) => a.date.localeCompare(b.date));

  // (4) Rateio de custos + validação cruzada por nota.
  const events: TradeEvent[] = [];
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
    custosTotais.irrf += note.irrf;

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
  const dailyRealized = new Map<string, number>();

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
      };
      tickers.set(key, acc);
    }
    return acc;
  };

  const addDaily = (date: string, value: number) => {
    dailyRealized.set(date, (dailyRealized.get(date) ?? 0) + value);
  };

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
    for (const key2 of COST_KEYS) {
      acc.costs[key2] += ev.costs[key2];
    }
    acc.costs.irrf += ev.irrf;
    // Custos do dia entram na série diária no dia em que ocorrem (IRRF fica
    // fora do líquido, registrado à parte — regra 5).
    addDaily(ev.date, -Object.values(ev.costs).reduce((a, b) => a + b, 0));
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
        acc.bruto += bruto;
        acc.dayTradeQty += matched * 2;
        closedOps.push({
          date,
          ticker,
          tipo: "day_trade",
          quantidade: matched,
          bruto,
        });
        addDaily(date, bruto);
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

        // (8) bmf carregado: resultado vem dos ajustes diários — não realiza.
        if (market !== "bmf") {
          acc.bruto += bruto;
          acc.swingClosedQty += closeQty;
          closedOps.push({
            date,
            ticker,
            tipo: "swing",
            quantidade: closeQty,
            bruto,
          });
          addDaily(date, bruto);
        }

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
    const liquido = acc.bruto + acc.ajustes - custosTotal;

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
      resultadoBruto: round2(acc.bruto),
      ajustesFuturos: round2(acc.ajustes),
      custos: round2(custosTotal),
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
      total: round2(custosTotal + acc.costs.irrf),
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

  // Série diária de P/L: realizado + ajustes de futuros + aluguel, com acumulado.
  const allDates = new Set<string>([
    ...dailyRealized.keys(),
    ...dailyAdjustments.keys(),
    ...dailyLoan.keys(),
  ]);
  const serieDiaria: DailyPoint[] = [];
  let acumulado = 0;
  for (const date of [...allDates].sort()) {
    const resultado = dailyRealized.get(date) ?? 0;
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
      custos: round2(totalCustos),
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
