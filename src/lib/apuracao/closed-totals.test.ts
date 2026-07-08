import { describe, expect, it } from "vitest";
import {
  EMPTY_COSTS,
  type NormalizedNote,
  type NormalizedTrade,
} from "@/lib/btg/types";
import { computeClosedTotals, isFechado } from "./closed-totals";
import { apurar } from "./engine";

let noteSeq = 0;

function makeNote(overrides: Partial<NormalizedNote>): NormalizedNote {
  noteSeq += 1;
  return {
    accountNumber: "12345",
    date: "2026-01-05",
    market: "bov",
    noteNumber: `N${noteSeq}`,
    trades: [],
    adjustments: [],
    loanLines: [],
    costs: { ...EMPTY_COSTS },
    irrf: 0,
    summary: [],
    ...overrides,
  };
}

function trade(overrides: Partial<NormalizedTrade>): NormalizedTrade {
  const quantity = overrides.quantity ?? 100;
  const price = overrides.price ?? 10;
  return {
    ticker: "PETR4",
    side: "buy",
    quantity,
    price,
    grossValue: quantity * price,
    dayTradeHint: false,
    ...overrides,
  };
}

describe("isFechado / computeClosedTotals", () => {
  it("exclui ticker só com posição aberta (nada fechado, sem ajuste de futuros)", () => {
    const result = apurar([
      makeNote({ trades: [trade({ side: "buy", quantity: 100, price: 10 })] }),
    ]);
    expect(result.porTicker[0].quantidadeFechada).toBe(0);
    expect(isFechado(result.porTicker[0])).toBe(false);
    expect(computeClosedTotals(result)).toEqual({
      bruto: 0,
      custos: 0,
      liquido: 0,
      irrf: 0,
    });
  });

  it("inclui ticker com day trade fechado", () => {
    const result = apurar([
      makeNote({
        costs: { ...EMPTY_COSTS, corretagem: 5 },
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
    ]);
    expect(isFechado(result.porTicker[0])).toBe(true);
    expect(computeClosedTotals(result)).toEqual({
      bruto: 100,
      custos: 5,
      liquido: 95,
      irrf: 0,
    });
  });

  it("inclui ticker de futuros só com ajuste diário (sem negócio no período)", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        adjustments: [{ ticker: "CCMF25", value: 350 }],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.quantidadeFechada).toBe(0);
    expect(t.ajustesFuturos).toBe(350);
    expect(isFechado(t)).toBe(true); // ajuste já é resultado realizado
    expect(computeClosedTotals(result).liquido).toBe(350);
  });

  it("soma só os tickers fechados, ignorando os só-abertos", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ ticker: "PETR4", side: "buy", quantity: 100, price: 10 }),
          trade({ ticker: "PETR4", side: "sell", quantity: 100, price: 11 }),
        ],
      }),
      makeNote({
        trades: [
          trade({ ticker: "VALE3", side: "buy", quantity: 50, price: 60 }),
        ],
      }),
    ]);
    const closed = computeClosedTotals(result);
    expect(closed.liquido).toBe(100); // só o PETR4 fechado; VALE3 (aberto) fica de fora
    expect(closed.bruto).toBe(100);
  });

  it("bate com o resultado líquido do período quando nada fica aberto e não há aluguel", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
    ]);
    expect(computeClosedTotals(result).liquido).toBe(
      result.totais.resultadoLiquido,
    );
  });
});
