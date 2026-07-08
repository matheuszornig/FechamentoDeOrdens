import type { ConsolidatedResult, TickerResult } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Fechado" = algo de fato encerrado no período: quantidade fechada (day
 * trade, swing, exercício ou vencimento) ou ajuste de futuros — o ajuste já
 * é resultado realizado em caixa, mesmo sem quantidade fechada formal.
 * Único critério de exibição na tabela "Resultado fechado por ticker".
 */
export function isFechado(t: TickerResult): boolean {
  return t.quantidadeFechada !== 0 || t.ajustesFuturos !== 0;
}

export interface ClosedTotals {
  bruto: number;
  custos: number;
  liquido: number;
  irrf: number;
}

/**
 * Totais agregados só dos tickers "fechados" — a mesma base da tabela
 * "Resultado fechado por ticker", para os cards de resumo baterem com o
 * rodapé dessa tabela. Difere de `result.totais` (que soma o período
 * inteiro, incluindo posições só abertas e o aluguel).
 */
export function computeClosedTotals(result: ConsolidatedResult): ClosedTotals {
  const totals = result.porTicker.filter(isFechado).reduce(
    (acc, t) => ({
      bruto: acc.bruto + t.resultadoBruto + t.ajustesFuturos,
      custos: acc.custos + t.custos,
      liquido: acc.liquido + t.resultadoLiquido,
      irrf: acc.irrf + t.irrf,
    }),
    { bruto: 0, custos: 0, liquido: 0, irrf: 0 },
  );
  return {
    bruto: round2(totals.bruto),
    custos: round2(totals.custos),
    liquido: round2(totals.liquido),
    irrf: round2(totals.irrf),
  };
}
