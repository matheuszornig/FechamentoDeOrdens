import { describe, expect, it } from "vitest";
import {
  EMPTY_COSTS,
  type NormalizedNote,
  type NormalizedTrade,
} from "@/lib/btg/types";
import { apurar, dedupeNotes } from "./engine";

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

  it("líquido = bruto − custos rateados − IRRF; custos do ticker inclui o IRRF", () => {
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
    // "Custos" do ticker = mesma definição de custosPorTicker[i].total —
    // inclui o IRRF, para as duas tabelas baterem por ticker.
    expect(t.custos).toBe(21.05); // 20 (corretagem) + 1.05 (irrf)
    expect(t.resultadoLiquido).toBe(78.95); // 100 − 21.05
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
    expect(result.serieDiaria.map((d) => d.ajustesFuturos)).toEqual([
      350, -120,
    ]);
  });

  it("day trade de futuros: financeiro vem das linhas liquidadas, matching é só estatística", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        trades: [
          trade({ ticker: "CCMF25", side: "buy", quantity: 5, price: 62 }),
          trade({ ticker: "CCMF25", side: "sell", quantity: 5, price: 63 }),
        ],
        // Liquidação das duas pontas contra o ajuste do dia (em reais).
        adjustments: [
          { ticker: "CCMF25", value: -100 },
          { ticker: "CCMF25", value: 150 },
        ],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.resultadoBruto).toBe(0); // nada realizado por diferença de preço
    expect(t.ajustesFuturos).toBe(50);
    expect(t.resultadoLiquido).toBe(50);
    expect(t.modalidade).toBe("day_trade");
    expect(t.quantidadeFechada).toBe(5);
  });

  it("futuro carregado não realiza swing (resultado vem dos ajustes)", () => {
    const result = apurar([
      makeNote({
        market: "bmf",
        date: "2026-01-05",
        trades: [
          trade({ ticker: "CCMF25", side: "buy", quantity: 5, price: 62 }),
        ],
      }),
      makeNote({
        market: "bmf",
        date: "2026-01-06",
        adjustments: [{ ticker: "CCMF25", value: 500 }],
      }),
      makeNote({
        market: "bmf",
        date: "2026-01-07",
        trades: [
          trade({ ticker: "CCMF25", side: "sell", quantity: 5, price: 64 }),
        ],
      }),
    ]);
    const t = result.porTicker.find((x) => x.ticker === "CCMF25");
    expect(t?.resultadoBruto).toBe(0); // sem dupla contagem com os ajustes
    expect(t?.ajustesFuturos).toBe(500);
    expect(t?.quantidadeFechada).toBe(5); // estatística de fechamento conta
    expect(result.posicoesAbertas).toHaveLength(0); // posição zerou
  });
});

describe("exercício de opções", () => {
  it("short assignado: opção fecha a 0 (prêmio ganho) e ações abrem ao strike", () => {
    const result = apurar([
      // Vende 2500 puts AZZAQ205 @ 0,50 (prêmio recebido).
      makeNote({
        market: "option",
        date: "2026-05-04",
        trades: [
          trade({
            ticker: "AZZAQ205",
            side: "sell",
            quantity: 2500,
            price: 0.5,
            maturity: "2026-05-15",
          }),
        ],
      }),
      // Exercício em 15/05: assignado, compra AZZA3 a 20,53 (strike).
      makeNote({
        market: "bov",
        date: "2026-05-15",
        trades: [
          {
            ...trade({
              ticker: "AZZAQ205E",
              side: "buy",
              quantity: 2500,
              price: 20.53,
            }),
            exercise: { optionTicker: "AZZAQ205", underlying: "AZZA3" },
          },
        ],
      }),
    ]);

    const opcao = result.porTicker.find((t) => t.ticker === "AZZAQ205");
    expect(opcao?.resultadoBruto).toBe(1250); // 2500 × 0,50 de prêmio
    // Papel-objeto entra comprado ao strike, sem resultado realizado.
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "AZZA3",
        mercado: "bov",
        side: "comprado",
        quantidade: 2500,
        precoMedio: 20.53,
      },
    ]);
    // A série exercida não fica em aberto.
    expect(
      result.posicoesAbertas.find((p) => p.ticker.startsWith("AZZAQ")),
    ).toBeUndefined();
    expect(result.serieDiaria.at(-1)).toMatchObject({
      date: "2026-05-15",
      resultado: 1250,
    });
  });

  it("exercício sem posição correspondente gera alerta", () => {
    const result = apurar([
      makeNote({
        market: "bov",
        date: "2026-05-15",
        trades: [
          {
            ...trade({
              ticker: "AZZAQ205E",
              side: "buy",
              quantity: 2500,
              price: 20.53,
            }),
            exercise: { optionTicker: "AZZAQ205", underlying: "AZZA3" },
          },
        ],
      }),
    ]);
    expect(result.alertas.some((a) => a.includes("AZZAQ205"))).toBe(true);
  });
});

describe("vencimento de opções", () => {
  it("short não exercido até o vencimento realiza o prêmio", () => {
    const result = apurar(
      [
        makeNote({
          market: "option",
          date: "2026-07-07",
          trades: [
            trade({
              ticker: "VALES795",
              side: "sell",
              quantity: 300,
              price: 1.26,
              maturity: "2026-07-17",
            }),
          ],
        }),
      ],
      { endDate: "2026-07-31" },
    );
    const t = result.porTicker.find((x) => x.ticker === "VALES795");
    expect(t?.resultadoBruto).toBe(378); // 300 × 1,26
    expect(result.posicoesAbertas).toHaveLength(0);
    expect(result.serieDiaria.at(-1)).toMatchObject({
      date: "2026-07-17",
      resultado: 378,
    });
  });

  it("long que vira pó realiza a perda do prêmio", () => {
    const result = apurar(
      [
        makeNote({
          market: "option",
          date: "2026-07-07",
          trades: [
            trade({
              ticker: "PETRE380",
              side: "buy",
              quantity: 100,
              price: 2,
              maturity: "2026-07-17",
            }),
          ],
        }),
      ],
      { endDate: "2026-07-31" },
    );
    expect(result.porTicker[0].resultadoBruto).toBe(-200);
    expect(result.posicoesAbertas).toHaveLength(0);
  });

  it("vencimento fora do período mantém a posição em aberto", () => {
    const result = apurar(
      [
        makeNote({
          market: "option",
          date: "2026-07-07",
          trades: [
            trade({
              ticker: "VALES795",
              side: "sell",
              quantity: 300,
              price: 1.26,
              maturity: "2026-07-17",
            }),
          ],
        }),
      ],
      { endDate: "2026-07-10" },
    );
    expect(result.porTicker[0].resultadoBruto).toBe(0);
    expect(result.posicoesAbertas).toHaveLength(1);
  });
});

describe("preço médio de compra e venda", () => {
  it("calcula PM ponderado por lado", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "buy", quantity: 300, price: 12 }),
          trade({ side: "sell", quantity: 200, price: 14 }),
        ],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.precoMedioCompra).toBe(11.5); // (100×10 + 300×12) / 400
    expect(t.precoMedioVenda).toBe(14);
  });

  it("sem negócios de um lado, PM é null", () => {
    const result = apurar([
      makeNote({ trades: [trade({ side: "buy", quantity: 100, price: 10 })] }),
    ]);
    expect(result.porTicker[0].precoMedioCompra).toBe(10);
    expect(result.porTicker[0].precoMedioVenda).toBeNull();
  });
});

describe("quantidade fechada", () => {
  it("1000 compradas e 500 vendidas em dias distintos fecham 500 (swing)", () => {
    const result = apurar([
      makeNote({
        date: "2026-01-05",
        trades: [trade({ side: "buy", quantity: 1000, price: 10 })],
      }),
      makeNote({
        date: "2026-01-06",
        trades: [trade({ side: "sell", quantity: 500, price: 11 })],
      }),
    ]);
    const t = result.porTicker[0];
    expect(t.quantidade).toBe(1500); // total negociado (1000 + 500)
    expect(t.quantidadeFechada).toBe(500); // só o que foi de fato encerrado
  });

  it("day trade casado no mesmo pregão conta a quantidade fechada de um lado só", () => {
    const result = apurar([
      makeNote({
        trades: [
          trade({ side: "buy", quantity: 200, price: 10 }),
          trade({ side: "sell", quantity: 200, price: 11 }),
        ],
      }),
    ]);
    // dayTradeQty acumula as duas pontas (400); fechada reporta uma ponta (200).
    expect(result.porTicker[0].quantidadeFechada).toBe(200);
  });

  it("posição só aberta (sem contraparte) não fecha nada", () => {
    const result = apurar([
      makeNote({ trades: [trade({ side: "buy", quantity: 300, price: 10 })] }),
    ]);
    expect(result.porTicker[0].quantidadeFechada).toBe(0);
  });

  it("vencimento de opção conta como quantidade fechada", () => {
    const result = apurar(
      [
        makeNote({
          market: "option",
          date: "2026-07-07",
          trades: [
            trade({
              ticker: "VALES795",
              side: "sell",
              quantity: 300,
              price: 1.26,
              maturity: "2026-07-17",
            }),
          ],
        }),
      ],
      { endDate: "2026-07-31" },
    );
    expect(result.porTicker[0].quantidadeFechada).toBe(300);
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

  it("IRRF do aluguel não vaza para custosTotais (fica só em aluguel.irrf)", () => {
    const result = apurar([
      makeNote({
        market: "bov",
        costs: { ...EMPTY_COSTS, corretagem: 5 },
        irrf: 0.5,
        trades: [
          trade({ side: "buy", quantity: 100, price: 10 }),
          trade({ side: "sell", quantity: 100, price: 11 }),
        ],
      }),
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
        ],
        irrf: 1.86,
      }),
    ]);
    // custosTotais.irrf só reflete o IRRF de ações/opções/futuros — o rodapé
    // da tabela "Custos por Ticker" bate com a soma das próprias linhas
    // (nenhum ticker "aluguel" existe nessa tabela).
    expect(result.custosTotais.irrf).toBe(0.5);
    expect(result.custosTotais.total).toBe(5.5); // 5 (corretagem) + 0.5 (irrf trading)
    expect(result.aluguel.irrf).toBe(1.86);
    const sumRowsTotal = result.custosPorTicker.reduce(
      (a, c) => a + c.total,
      0,
    );
    expect(sumRowsTotal).toBe(result.custosTotais.total);
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

describe("dedupeNotes", () => {
  it("remove cópias da mesma nota (nº nota + conta + mercado), ordenado por data", () => {
    const note = makeNote({ noteNumber: "31381536", date: "2026-04-15" });
    const earlier = makeNote({ noteNumber: "1", date: "2026-01-05" });
    // Simula o cenário real: rawPayload é armazenado por dia e replicado em
    // toda linha extraída daquele dia — re-mapear várias linhas do mesmo dia
    // sem dedup gera N cópias idênticas da mesma nota.
    const copies = Array.from({ length: 12 }, () => structuredClone(note));
    const deduped = dedupeNotes([...copies, earlier]);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((n) => n.date)).toEqual(["2026-01-05", "2026-04-15"]);
  });

  it("preserva notas de mercados diferentes com o mesmo número", () => {
    const bov = makeNote({ noteNumber: "111", market: "bov" });
    const option = makeNote({ noteNumber: "111", market: "option" });
    expect(dedupeNotes([bov, option])).toHaveLength(2);
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
      {
        date: "2026-01-05",
        resultado: 100,
        ajustesFuturos: 0,
        aluguel: 0,
        total: 100,
        acumulado: 100,
      },
      {
        date: "2026-01-06",
        resultado: 0,
        ajustesFuturos: -50,
        aluguel: 0,
        total: -50,
        acumulado: 50,
      },
      {
        date: "2026-01-07",
        resultado: 0,
        ajustesFuturos: 0,
        aluguel: 10,
        total: 10,
        acumulado: 60,
      },
    ]);
    expect(result.totais.resultadoLiquido).toBe(60);
  });
});

describe("posição inicial (D-1)", () => {
  it("venda de posição semeada realiza contra o preço médio da carteira", () => {
    const result = apurar(
      [
        makeNote({
          date: "2026-01-05",
          costs: { ...EMPTY_COSTS, corretagem: 4 },
          trades: [
            trade({ ticker: "VALE3", side: "sell", quantity: 100, price: 12 }),
          ],
        }),
      ],
      {
        initialPositions: [
          { ticker: "VALE3", market: "bov", quantity: 300, avgPrice: 10 },
        ],
      },
    );
    const t = result.porTicker.find((x) => x.ticker === "VALE3");
    expect(t?.resultadoBruto).toBe(200); // (12 − 10) × 100
    expect(t?.quantidadeFechada).toBe(100);
    expect(t?.resultadoLiquido).toBe(196);
    // Restante da posição semeada segue aberto, ao preço médio original.
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "VALE3",
        mercado: "bov",
        side: "comprado",
        quantidade: 200,
        precoMedio: 10,
      },
    ]);
  });

  it("posição semeada não mexida só aparece em posições abertas (sem linha de resultado)", () => {
    const result = apurar([], {
      initialPositions: [
        { ticker: "BRAV3", market: "bov", quantity: 1600, avgPrice: 18.8 },
      ],
    });
    expect(result.porTicker).toHaveLength(0);
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "BRAV3",
        mercado: "bov",
        side: "comprado",
        quantidade: 1600,
        precoMedio: 18.8,
      },
    ]);
  });

  it("posição semeada vendida (short) fecha com recompra", () => {
    const result = apurar(
      [
        makeNote({
          date: "2026-01-05",
          trades: [
            trade({ ticker: "PETR4", side: "buy", quantity: 50, price: 9 }),
          ],
        }),
      ],
      {
        initialPositions: [
          { ticker: "PETR4", market: "bov", quantity: -50, avgPrice: 11 },
        ],
      },
    );
    const t = result.porTicker.find((x) => x.ticker === "PETR4");
    expect(t?.resultadoBruto).toBe(100); // short: (11 − 9) × 50
    expect(result.posicoesAbertas).toHaveLength(0);
  });

  it("compra no período soma à posição semeada pelo preço médio ponderado", () => {
    const result = apurar(
      [
        makeNote({
          date: "2026-01-05",
          trades: [
            trade({ ticker: "ITUB4", side: "buy", quantity: 100, price: 20 }),
          ],
        }),
      ],
      {
        initialPositions: [
          { ticker: "ITUB4", market: "bov", quantity: 100, avgPrice: 10 },
        ],
      },
    );
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "ITUB4",
        mercado: "bov",
        side: "comprado",
        quantidade: 200,
        precoMedio: 15, // (100×10 + 100×20) / 200
      },
    ]);
  });
});
