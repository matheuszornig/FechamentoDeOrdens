import { describe, expect, it } from "vitest";
import { EMPTY_COSTS, type NormalizedNote, type NormalizedTrade } from "@/lib/btg/types";
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

describe("day trade", () => {
  it("compra e venda casadas no mesmo pregão viram day trade", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.ticker).toBe("PETR4");
    expect(t.modalidade).toBe("day_trade");
    expect(t.resultadoBruto).toBe(100); // 100 × (11 − 10)
    expect(result.posicoesAbertas).toHaveLength(0);
    expect(result.totais.operacoesFechadas).toBe(1);
    expect(result.totais.taxaAcerto).toBe(100);
  });

  it("excedente do day trade vai para a posição (swing)", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ side: "buy", quantity: 200, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.resultadoBruto).toBe(100); // só a parte casada realiza
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "PETR4",
        mercado: "bov",
        side: "comprado",
        quantidade: 100,
        precoMedio: 10,
      },
    ]);
  });
});

describe("swing com preço médio ponderado", () => {
  it("compras em dias distintos formam preço médio; venda parcial fecha parcialmente", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [trade({ side: "buy", quantity: 100, price: 10 })],
      }),
      makeNote({
        date: "2026-01-06",
        trades: [trade({ side: "buy", quantity: 100, price: 12 })],
      }),
      makeNote({
        date: "2026-01-07",
        trades: [trade({ side: "sell", quantity: 100, price: 13 })],
      }),
    ]);
    const t = result.porTicker[0];
    // Preço médio (100×10 + 100×12)/200 = 11 → venda de 100 @13 realiza 200.
    expect(t.resultadoBruto).toBe(200);
    expect(t.modalidade).toBe("swing");
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "PETR4",
        mercado: "bov",
        side: "comprado",
        quantidade: 100,
        precoMedio: 11,
      },
    ]);
  });
});

describe("short", () => {
  it("venda abre posição vendida e compra posterior fecha", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [trade({ side: "sell", quantity: 100, price: 10 })],
      }),
      makeNote({
        date: "2026-01-06",
        trades: [trade({ side: "buy", quantity: 100, price: 8 })],
      }),
    ]);
    expect(result.porTicker[0].resultadoBruto).toBe(200); // 100 × (10 − 8)
    expect(result.posicoesAbertas).toHaveLength(0);
  });

  it("fechamento que excede a posição inverte o lado", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [trade({ side: "sell", quantity: 100, price: 10 })],
      }),
      makeNote({
        date: "2026-01-06",
        trades: [trade({ side: "buy", quantity: 150, price: 9 })],
      }),
    ]);
    expect(result.porTicker[0].resultadoBruto).toBe(100); // fecha 100 short
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "PETR4",
        mercado: "bov",
        side: "comprado",
        quantidade: 50,
        precoMedio: 9,
      },
    ]);
  });
});

describe("rateio de custos", () => {
  it("custos da nota são rateados proporcionalmente ao valor financeiro", () => {
    const result = apurar([
      makeNote({
        costs: { ...EMPTY_COSTS, corretagem: 40 },
        trades: [
          trade({ ticker: "PETR4", side: "buy", quantity: 100, price: 10 }), // 1.000
          trade({ ticker: "VALE3", side: "buy", quantity: 50, price: 60 }), // 3.000
        ],
      }),
    ]);
    const petr = result.custosPorTicker.find((c) => c.ticker === "PETR4");
    const vale = result.custosPorTicker.find((c) => c.ticker === "VALE3");
    expect(petr?.corretagem).toBe(10); // 1000/4000 × 40
    expect(vale?.corretagem).toBe(30); // 3000/4000 × 40
  });

  it("líquido = bruto − custos rateados, com IRRF registrado à parte", () => {
    const result = apurar([
      makeNote({
        costs: { ...EMPTY_COSTS, corretagem: 20 },
        irrf: 1.05,
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.resultadoBruto).toBe(100);
    expect(t.custos).toBe(20);
    expect(t.resultadoLiquido).toBe(80); // IRRF não abate o líquido
    expect(t.irrf).toBe(1.05);
    expect(result.custosTotais.irrf).toBe(1.05);
  });
});

describe("futuros (bmf)", () => {
  it("AJUPOS fica fora do matching e soma como ajuste diário", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        date: "2026-01-05",
        adjustments: [{ ticker: "CCMF25", value: 350 }],
      }),
      makeNote({
        market: "bmf",
        date: "2026-01-06",
        adjustments: [{ ticker: "CCMF25", value: -120 }],
      }),
    ]);
    const t = result.porTicker.find((x) => x.ticker === "CCMF25");
    expect(t?.ajustesFuturos).toBe(230);
    expect(t?.resultadoLiquido).toBe(230);
    expect(result.totais.operacoesFechadas).toBe(0); // nada entrou no matching
    expect(result.serieDiaria.map((d) => d.ajustesFuturos)).toEqual([350, -120]);
  });

  it("day trade de futuros entra no matching normal", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        trades: [
          trade({ ticker: "CCMF25", side: "buy", quantity: 5, price: 62, dayTradeHint: true }),
          trade({ ticker: "CCMF25", side: "sell", quantity: 5, price: 63, dayTradeHint: true }),
        ],
      }),
    ]);
    expect(result.porTicker[0].resultadoBruto).toBe(5);
    expect(result.porTicker[0].modalidade).toBe("day_trade");
  });

  it("futuro carregado não realiza swing (resultado vem dos ajustes)", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        date: "2026-01-05",
        trades: [trade({ ticker: "CCMF25", side: "buy", quantity: 5, price: 62 })],
      }),
      makeNote({
        market: "bmf",
        date: "2026-01-06",
        adjustments: [{ ticker: "CCMF25", value: 500 }],
      }),
      makeNote({
        market: "bmf",
        date: "2026-01-07",
        trades: [trade({ ticker: "CCMF25", side: "sell", quantity: 5, price: 64 })],
      }),
    ]);
    const t = result.porTicker.find((x) => x.ticker === "CCMF25");
    expect(t?.resultadoBruto).toBe(0); // sem dupla contagem com os ajustes
    expect(t?.ajustesFuturos).toBe(500);
    expect(result.posicoesAbertas).toHaveLength(0); // posição zerou
  });
});

describe("aluguel (loan)", () => {
  it("entra como linha separada, fora do matching", () => {
    const result = apurar([
      makeNote({
        market: "loan",
        loanLines: [
          {
            symbol: "PETR4",
            side: "doador",
            quantity: 300,
            fee: 0,
            remuneration: 12.4,
            irrf: 1.86,
          },
          {
            symbol: "VALE3",
            side: "tomador",
            quantity: 100,
            fee: 4.1,
            remuneration: 0,
            irrf: 0,
          },
        ],
        irrf: 1.86,
      }),
    ]);
    expect(result.aluguel).toEqual({
      taxas: 4.1,
      remuneracao: 12.4,
      irrf: 1.86,
      liquido: 6.44,
    });
    expect(result.porTicker).toHaveLength(0); // não entra no matching
    expect(result.serieDiaria[0].aluguel).toBe(6.44);
    expect(result.totais.resultadoLiquido).toBe(6.44);
  });
});

describe("idempotência", () => {
  it("reprocessar a mesma nota não duplica resultados", () => {
    const note = makeNote({
      noteNumber: "445566",
      trades: [
        trade({ side: "buy", quantity: 100, price: 10 }),
        trade({ side: "sell", quantity: 100, price: 11 }),
      ],
    });
    const once = apurar([note]);
    const twice = apurar([note, structuredClone(note)]);
    expect(twice).toEqual(once);
  });

  it("notas de mercados diferentes com o mesmo número não colidem", () => {
    const bov = makeNote({
      noteNumber: "111",
      market: "bov",
      trades: [
        trade({ side: "buy", quantity: 100, price: 10 }),
        trade({ side: "sell", quantity: 100, price: 11 }),
      ],
    });
    const option = makeNote({
      noteNumber: "111",
      market: "option",
      trades: [
        trade({ ticker: "PETRE380", side: "buy", quantity: 100, price: 1 }),
        trade({ ticker: "PETRE380", side: "sell", quantity: 100, price: 1.5 }),
      ],
    });
    const result = apurar([bov, option]);
    expect(result.porTicker).toHaveLength(2);
  });
});

describe("validação cruzada", () => {
  it("divergência com o summarizedTradeList gera alerta", () => {
    const result = apurar([
      makeNote({
        noteNumber: "445566",
        trades: [trade({ side: "buy", quantity: 100, price: 10 })],
        summary: [{ ticker: "PETR4", quantity: 300, value: 3000 }],
      }),
    ]);
    expect(result.alertas).toHaveLength(1);
    expect(result.alertas[0]).toContain("445566");
    expect(result.alertas[0]).toContain("PETR4");
  });

  it("consolidado consistente não gera alerta", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
        summary: [{ ticker: "PETR4", quantity: 200, value: 2100 }],
      }),
    ]);
    expect(result.alertas).toHaveLength(0);
  });
});

describe("série diária de P/L", () => {
  it("acumulado soma resultado, ajustes e aluguel dia a dia", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
      makeNote({
        date: "2026-01-06",
        market: "bmf",
        adjustments: [{ ticker: "CCMF25", value: -50 }],
      }),
      makeNote({
        date: "2026-01-07",
        market: "loan",
        loanLines: [
          {
            symbol: "PETR4",
            side: "doador",
            quantity: 100,
            fee: 0,
            remuneration: 10,
            irrf: 0,
          },
        ],
      }),
    ]);
    expect(result.serieDiaria).toEqual([
      { date: "2026-01-05", resultado: 100, ajustesFuturos: 0, aluguel: 0, total: 100, acumulado: 100 },
      { date: "2026-01-06", resultado: 0, ajustesFuturos: -50, aluguel: 0, total: -50, acumulado: 50 },
      { date: "2026-01-07", resultado: 0, ajustesFuturos: 0, aluguel: 10, total: 10, acumulado: 60 },
    ]);
    expect(result.totais.resultadoLiquido).toBe(60);
  });
});
