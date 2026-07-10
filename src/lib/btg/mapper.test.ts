import { describe, expect, it } from "vitest";
import {
  deriveOptionExpiry,
  deriveUnderlying,
  mapNotesPayload,
  mapNotesPayloadWithRaw,
  mapPositionPayload,
  normalizeCost,
  normalizeDoc,
  parseBrDate,
  parseTicker,
  prazoToExpiry,
  stripFractionalSuffix,
  stripTermoSuffix,
  thirdFriday,
  toNumber,
  trimPositionPayload,
} from "./mapper";

describe("helpers de normalização", () => {
  it("converte datas DD/MM/YYYY e ISO", () => {
    expect(parseBrDate("05/01/2026")).toBe("2026-01-05");
    expect(parseBrDate("2026-01-05T00:00:00")).toBe("2026-01-05");
    expect(parseBrDate("2026-01-05")).toBe("2026-01-05");
    expect(parseBrDate("string")).toBeNull();
    expect(parseBrDate(undefined)).toBeNull();
  });

  it("separa ticker e especificação por tab", () => {
    expect(parseTicker("AMER3\tON")).toBe("AMER3");
    expect(parseTicker("PETR4\tPN N2")).toBe("PETR4");
    expect(parseTicker("CCMF25")).toBe("CCMF25");
    expect(parseTicker("string")).toBeNull();
  });

  it("junta o ticker do mercado fracionário com o lote cheio", () => {
    expect(stripFractionalSuffix("PETR4F")).toBe("PETR4");
    expect(stripFractionalSuffix("VALE3F")).toBe("VALE3");
    expect(stripFractionalSuffix("ENGI11F")).toBe("ENGI11"); // unit, 2 dígitos
    expect(stripFractionalSuffix("PETR4")).toBe("PETR4"); // lote cheio, sem mudança
    expect(stripFractionalSuffix("CCMF25")).toBe("CCMF25"); // futuro, não é fracionário
  });

  it("junta o ticker do termo com o papel-objeto", () => {
    expect(stripTermoSuffix("ASAI3T")).toBe("ASAI3");
    expect(stripTermoSuffix("KEPL3T")).toBe("KEPL3");
    expect(stripTermoSuffix("ENGI11T")).toBe("ENGI11"); // unit, 2 dígitos
    expect(stripTermoSuffix("ASAI3")).toBe("ASAI3"); // à vista, sem mudança
    expect(stripTermoSuffix("WINM26")).toBe("WINM26"); // futuro, não é termo
  });

  it("ignora placeholders 'string' sem falhar", () => {
    expect(toNumber("string")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(12.5)).toBe(12.5);
  });

  it("converte strings numéricas: ponto decimal (API real) e formato BR", () => {
    expect(toNumber("378.0")).toBe(378); // real: decimal em ponto
    expect(toNumber("1.26")).toBe(1.26);
    expect(toNumber("300")).toBe(300);
    expect(toNumber("1.234,56")).toBe(1234.56); // BR: milhar + vírgula
    expect(toNumber("-0.13")).toBe(-0.13);
  });

  it("normaliza custos com indicador D/C: débito positivo, crédito negativo", () => {
    expect(normalizeCost(10.5, "D")).toBe(10.5);
    expect(normalizeCost(-10.5, "D")).toBe(10.5);
    expect(normalizeCost(10.5, "C")).toBe(-10.5);
    expect(normalizeCost(-3.2)).toBe(3.2); // sem indicador → absoluto
  });

  it("remove máscara de CPF/CNPJ", () => {
    expect(normalizeDoc("123.456.789-00")).toBe("12345678900");
    expect(normalizeDoc("12.345.678/0001-90")).toBe("12345678000190");
  });

  it("calcula a 3ª sexta-feira (vencimento B3)", () => {
    // Datas reais de exercício observadas no payload do BTG.
    expect(thirdFriday(2026, 2)).toBe("2026-02-20");
    expect(thirdFriday(2026, 5)).toBe("2026-05-15");
    expect(thirdFriday(2026, 7)).toBe("2026-07-17");
    expect(prazoToExpiry("02/26")).toBe("2026-02-20");
    expect(prazoToExpiry("")).toBeNull();
    expect(prazoToExpiry("string")).toBeNull();
  });

  it("deriva o papel-objeto do exercício pela raiz + especificação", () => {
    expect(deriveUnderlying("AZZAQ205", "ON")).toBe("AZZA3");
    expect(deriveUnderlying("ASAIB769", "ON")).toBe("ASAI3");
    expect(deriveUnderlying("PETRE380", "PN N2")).toBe("PETR4");
    expect(deriveUnderlying("VALES795", "UNT")).toBe("VALE11");
    expect(deriveUnderlying("AZZAQ205", "XX")).toBeNull();
  });

  it("exercício de opção de ETF/unit (sem especificação na nota) vira sufixo 11", () => {
    // Nota real: "BOVAE17E" (sem "\t") — BOVA11 exercida. Diferente de ações,
    // que sempre trazem "\tON"/"\tPN" (confirmado em todo exercício real
    // observado nas contas testadas).
    expect(deriveUnderlying("BOVAE17", undefined)).toBe("BOVA11");
  });
});

describe("mapNotesPayload — bov/option", () => {
  const payload = {
    bov: [
      {
        ticketInfo: {
          numeroNota: "445566",
          dataPregao: "05/01/2026",
          dataLiqui: "07/01/2026",
          codCliente: "12345",
          docCliente: "123.456.789-00",
          bolsaDataEmol: 1.2,
          bolsaDataEmolText: "D",
          clearDataTaxaLiq: 2.5,
          clearDataTaxaLiqText: "D",
          clearDataTaxaReg: 0.3,
          clearDataTaxaRegText: "D",
          correDataTotal: 9.9,
          correDataTotalText: "D",
          correDataIss: 0.5,
          correDataIssText: "D",
          correDataIrrf: 0.11,
          correDataIrrfText: "D",
          correDataTTA: 0.1,
          correDataTTAText: "D",
          pis: 0.06,
          cofins: 0.28,
          corretDayTrade: "Corretagem: -R$ 3,00",
        },
        tradeList: [
          {
            cV: "C",
            specTitulo: "AMER3\tON",
            quantidade: 100,
            precoAjuste: 10,
            valorOperacao: 1000,
            tipoMercado: "VISTA",
            obs: "D",
          },
          {
            cV: "V",
            specTitulo: "AMER3\tON",
            quantidade: 100,
            precoAjuste: 11,
            valorOperacao: 1100,
            tipoMercado: "VISTA",
            obs: "D",
          },
          // Placeholder da doc — deve ser ignorado.
          {
            cV: "string",
            specTitulo: "string",
            quantidade: 0,
            precoAjuste: 0,
            valorOperacao: 0,
            tipoMercado: "string",
            obs: "string",
          },
        ],
        summarizedTradeList: [
          { specTitulo: "AMER3\tON", quantidade: 200, valorOperacao: 2100 },
        ],
      },
    ],
    option: [],
    bmf: [],
    loan: [],
  };

  it("mapeia trades, custos e datas", () => {
    const notes = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.market).toBe("bov");
    expect(note.date).toBe("2026-01-05");
    expect(note.noteNumber).toBe("445566");
    expect(note.trades).toHaveLength(2); // placeholder ignorado
    expect(note.trades[0]).toMatchObject({
      ticker: "AMER3",
      side: "buy",
      quantity: 100,
      price: 10,
      grossValue: 1000,
      dayTradeHint: true,
    });
    expect(note.trades[1].side).toBe("sell");
    expect(note.costs).toEqual({
      corretagem: 9.9,
      emolumentos: 1.2,
      liquidacao: 2.5,
      registro: 0.3,
      iss: 0.5,
      pis: 0.06,
      cofins: 0.28,
      outros: 0.1,
    });
    expect(note.irrf).toBe(0.11);
    expect(note.summary).toEqual([
      { ticker: "AMER3", quantity: 200, value: 2100 },
    ]);
  });

  it("aceita campos extras sem falhar (schema tolerante)", () => {
    const extra = structuredClone(payload) as Record<string, unknown>;
    (extra.bov as Record<string, unknown>[])[0].campoNovoDoBtg = {
      qualquer: 1,
    };
    expect(() => mapNotesPayload(extra, "12345", "2026-01-05")).not.toThrow();
  });
});

describe("mapNotesPayload — mercado fracionário (bov)", () => {
  // Nota real: compra no lote cheio (PETR4) e no fracionário (PETR4F) do
  // mesmo papel, no mesmo dia — o consolidado da nota traz as duas pernas
  // como entradas separadas, como acontece de fato na B3.
  const payload = {
    bov: [
      {
        ticketInfo: { numeroNota: "1", dataPregao: "05/01/2026" },
        tradeList: [
          {
            cV: "C",
            specTitulo: "PETR4\tPN",
            quantidade: 100,
            precoAjuste: 38,
            valorOperacao: 3800,
            tipoMercado: "VISTA",
          },
          {
            cV: "C",
            specTitulo: "PETR4F\tPN",
            quantidade: 37,
            precoAjuste: 38.1,
            valorOperacao: 1409.7,
            tipoMercado: "VISTA",
          },
        ],
        summarizedTradeList: [
          { specTitulo: "PETR4\tPN", quantidade: 100, valorOperacao: 3800 },
          { specTitulo: "PETR4F\tPN", quantidade: 37, valorOperacao: 1409.7 },
        ],
      },
    ],
    option: [],
    bmf: [],
    loan: [],
  };

  it("junta o ticker do fracionário (PETR4F) com o lote cheio (PETR4)", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.trades.map((t) => t.ticker)).toEqual(["PETR4", "PETR4"]);
  });

  it("soma as duas pernas do consolidado sob o mesmo ticker (sem alerta de validação cruzada)", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.summary).toEqual([
      { ticker: "PETR4", quantity: 137, value: 5209.7 },
    ]);
  });

  it("compra a termo (sufixo T) conta no papel-objeto", () => {
    // Linha real observada: tipoMercado TERMO, ticker ASAI3T, spec normal.
    const termoPayload = {
      bov: [
        {
          ticketInfo: { numeroNota: "3", dataPregao: "19/01/2026" },
          tradeList: [
            {
              cV: "C",
              specTitulo: "ASAI3T\tON",
              quantidade: "1260",
              precoAjuste: "7.72",
              valorOperacao: "9727.2",
              tipoMercado: "TERMO",
              prazo: "64",
            },
          ],
          summarizedTradeList: [
            {
              specTitulo: "ASAI3T\tON",
              quantidade: 1260,
              valorOperacao: 9727.2,
            },
          ],
        },
      ],
    };
    const [note] = mapNotesPayload(termoPayload, "12345", "2026-01-19");
    expect(note.trades[0]).toMatchObject({
      ticker: "ASAI3",
      side: "buy",
      quantity: 1260,
      price: 7.72,
    });
    expect(note.trades[0].maturity).toBeUndefined(); // prazo em dias ≠ vencimento de opção
    expect(note.summary).toEqual([
      { ticker: "ASAI3", quantity: 1260, value: 9727.2 },
    ]);
  });

  it("não normaliza tickers de opções que terminem em letra (mercado diferente)", () => {
    const optionPayload = {
      option: [
        {
          ticketInfo: { numeroNota: "2", dataPregao: "05/01/2026" },
          tradeList: [
            {
              cV: "C",
              specTitulo: "PETRE380F\tPN",
              quantidade: 100,
              precoAjuste: 1,
              valorOperacao: 100,
              tipoMercado: "OPCAO DE COMPRA",
            },
          ],
        },
      ],
    };
    const [note] = mapNotesPayload(optionPayload, "12345", "2026-01-05");
    // Fracionário só existe no mercado à vista — em opções o ticker fica intacto.
    expect(note.trades[0].ticker).toBe("PETRE380F");
  });
});

describe("mapNotesPayload — payload real da API (option)", () => {
  // Estrutura observada na resposta real de 07/07/2026 (dados pessoais
  // redigidos): números como string com decimal em ponto, indicadores D/C em
  // bolsaText*/clearText*/correText* e consolidado com titulo + totais por lado.
  const realPayload = {
    bov: [],
    bmf: [],
    loan: [],
    option: [
      {
        summarizedTradeList: [
          {
            precoMedioVenda: "1.26",
            precoMedioCredito: "1.26",
            quantidadeTotalVenda: "300",
            quantidadeTotalCredito: "300",
            titulo: "VALES795\tON",
            valorTotalVenda: "378.0",
            valorTotalCredito: "378.0",
          },
        ],
        ticketInfo: {
          bolsaDataEmol: "0.13",
          bolsaTextEmol: "D",
          clearDataTaxaLiq: "0.1",
          clearTextTaxaLiq: "D",
          clearDataTaxaReg: "0.26",
          clearTextTaxaReg: "D",
          clearDataTotal: "377.64",
          clearTextTotal: "C",
          codCliente: "85-0 004121241",
          correDataIrrf: "0.01",
          correDataIss: "0.0",
          correDataTTA: "0.0",
          correDataTotal: "0.0",
          correTextIrrf: "",
          correTextIss: "",
          correTextTotal: "",
          correTextTTA: "",
          corretDayTrade: "",
          dataLiqui: "08/07/2026",
          dataPregao: "07/07/2026",
          docCliente: "000.000.000-00",
          liquiData: "377.51",
          liquiText: "C",
          nomeCliente: "CLIENTE REDIGIDO",
          numeroCliente: "004121241",
          numeroNota: "32963952",
        },
        tradeList: [
          {
            cV: "V",
            dC: "C",
            negociacao: "1-BOVESPA",
            obs: "",
            prazo: "07/26",
            precoAjuste: "1.26",
            precoAjusteBigDecimal: "1.26",
            q: "",
            quantidade: "300",
            specTitulo: "VALES795\tON",
            tipoMercado: "OPCAO DE VENDA",
            valorOperacao: "378.0",
            valorOperacaoBigDecimal: "378.0",
          },
        ],
      },
    ],
  };

  it("mapeia números-string, custos com nomes reais e consolidado por lado", () => {
    const notes = mapNotesPayload(realPayload, "004121241", "2026-07-07");
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.market).toBe("option");
    expect(note.date).toBe("2026-07-07");
    expect(note.noteNumber).toBe("32963952");
    expect(note.trades).toEqual([
      {
        ticker: "VALES795",
        side: "sell",
        quantity: 300,
        price: 1.26,
        grossValue: 378,
        dayTradeHint: false,
        maturity: "2026-07-17", // 3ª sexta do prazo "07/26"
      },
    ]);
    expect(note.costs.emolumentos).toBe(0.13);
    expect(note.costs.liquidacao).toBe(0.1);
    expect(note.costs.registro).toBe(0.26);
    expect(note.costs.corretagem).toBe(0);
    expect(note.irrf).toBe(0.01);
    expect(note.summary).toEqual([
      { ticker: "VALES795", quantity: 300, value: 378 },
    ]);
  });

  it("não gera alerta de validação cruzada (consolidado bate com os negócios)", async () => {
    const { apurar } = await import("@/lib/apuracao/engine");
    const notes = mapNotesPayload(realPayload, "004121241", "2026-07-07");
    const result = apurar(notes);
    expect(result.alertas).toEqual([]);
    expect(result.posicoesAbertas).toEqual([
      {
        ticker: "VALES795",
        mercado: "option",
        side: "vendido",
        quantidade: 300,
        precoMedio: 1.26,
      },
    ]);
  });
});

describe("mapNotesPayload — exercício de opções (payload real)", () => {
  // Linhas reais observadas: ticker com sufixo "E", preço = strike.
  const payload = {
    bov: [
      {
        ticketInfo: {
          numeroNota: "31971366",
          dataPregao: "15/05/2026",
          numeroCliente: "004121241",
        },
        tradeList: [
          {
            cV: "C",
            dC: "D",
            obs: "",
            prazo: "",
            quantidade: "2500",
            specTitulo: "AZZAQ205E\tON",
            precoAjuste: "20.53",
            tipoMercado: "EXERC OPC VENDA",
            valorOperacao: "51325.0",
          },
          {
            cV: "V",
            dC: "C",
            obs: "",
            prazo: "",
            quantidade: "2500",
            specTitulo: "AZZAQ210E\tON",
            precoAjuste: "21.03",
            tipoMercado: "EXERC OPC VENDA",
            valorOperacao: "52575.0",
          },
        ],
      },
    ],
  };

  it("marca a linha como exercício com série e papel-objeto", () => {
    const [note] = mapNotesPayload(payload, "004121241", "2026-05-15");
    expect(note.trades).toHaveLength(2);
    expect(note.trades[0]).toMatchObject({
      ticker: "AZZAQ205E",
      side: "buy",
      quantity: 2500,
      price: 20.53,
      exercise: { optionTicker: "AZZAQ205", underlying: "AZZA3" },
    });
    expect(note.trades[1]).toMatchObject({
      ticker: "AZZAQ210E",
      side: "sell",
      exercise: { optionTicker: "AZZAQ210", underlying: "AZZA3" },
    });
  });

  it("opções ganham vencimento (3ª sexta) a partir do prazo", () => {
    const optionPayload = {
      option: [
        {
          ticketInfo: { numeroNota: "1", dataPregao: "05/01/2026" },
          tradeList: [
            {
              cV: "V",
              quantidade: "300",
              specTitulo: "VALES795\tON",
              precoAjuste: "1.26",
              tipoMercado: "OPCAO DE VENDA",
              valorOperacao: "378.0",
              prazo: "07/26",
            },
          ],
        },
      ],
    };
    const [note] = mapNotesPayload(optionPayload, "004121241", "2026-01-05");
    expect(note.trades[0].maturity).toBe("2026-07-17");
    expect(note.trades[0].exercise).toBeUndefined();
  });

  it("exercício de opção de ETF (BOVA11) sem specTitulo tabulado deriva o papel-objeto mesmo assim", () => {
    // Linha real observada (conta 004936963, nota 31981276): sem "\t" —
    // diferente das ações, cujo exercício sempre traz "\tON"/"\tPN".
    const payload = {
      bov: [
        {
          ticketInfo: { numeroNota: "31981276", dataPregao: "15/05/2026" },
          tradeList: [
            {
              cV: "V",
              dC: "C",
              quantidade: "19959",
              specTitulo: "BOVAE17E",
              precoAjuste: "170.0",
              tipoMercado: "EXERC OPC COMPRA",
              valorOperacao: "3393030.0",
            },
          ],
        },
      ],
    };
    const [note] = mapNotesPayload(payload, "004936963", "2026-05-15");
    expect(note.trades[0]).toMatchObject({
      ticker: "BOVAE17E",
      exercise: { optionTicker: "BOVAE17", underlying: "BOVA11" },
    });
  });
});

describe("mapNotesPayload — bmf", () => {
  // Formato real observado: tradeList no topo da nota (irmã de ticketInfo),
  // valores como string com ponto decimal, dC = débito/crédito da linha.
  const payload = {
    bmf: [
      {
        tradeList: [
          {
            mercadoria: "WINM26",
            cV: "C",
            dC: "D",
            quantidade: "5",
            precoAjuste: "170000.0",
            valorOperacao: "120.5",
            vencimento: "15/01/2027",
            tipoNegocio: "NORMAL",
            taxaOperacional: "40.0",
          },
          {
            mercadoria: "WINM26",
            cV: "V",
            dC: "C",
            quantidade: "5",
            precoAjuste: "170300.0",
            valorOperacao: "270.5",
            vencimento: "15/01/2027",
            tipoNegocio: "NORMAL",
            taxaOperacional: "40.0",
          },
          {
            mercadoria: "WINQ26",
            cV: "C",
            dC: "D",
            quantidade: "2",
            precoAjuste: "171000.0",
            valorOperacao: "320.5",
            vencimento: "18/08/2026",
            tipoNegocio: "AJUPOS",
            taxaOperacional: "0.0",
          },
        ],
        financialSummary: {
          bmf_fee: "-1.5",
          registry_fee: "-0.8",
          operational_fee: "-4.0",
          clearing: "-0.6",
          iss: "-0.2",
          pis: "-0.03",
          cofins: "-0.12",
          other_fees: "-0.05",
          total_fees: "-7.3",
          daytrade_adjustment: "150.0",
          position_adjustment: "-320.5",
          total_net: "-177.2",
        },
        ticketInfo: {
          numeroNota: "778899",
          dataPregao: "05/01/2026",
          codCliente: "12345",
          irrf: "0.0",
          irrfDayTrade: "1.2",
        },
      },
    ],
  };

  it("custos negativos do financialSummary viram positivos; IRRF vem do ticketInfo", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.costs.corretagem).toBe(4.0);
    expect(note.costs.emolumentos).toBe(1.5);
    expect(note.costs.liquidacao).toBe(0.6);
    expect(note.costs.registro).toBe(0.8);
    expect(note.costs.outros).toBe(0.05);
    expect(note.irrf).toBe(1.2);
  });

  it("toda linha liquida contra o ajuste do dia: NORMAL e AJUPOS viram ajustes assinados pelo dC", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.adjustments).toEqual([
      { ticker: "WINM26", value: -120.5 },
      { ticker: "WINM26", value: 270.5 },
      { ticker: "WINQ26", value: -320.5 },
    ]);
    // Negócios NORMAL entram no matching só como estatística.
    expect(note.trades).toHaveLength(2);
    expect(note.trades[0]).toMatchObject({
      ticker: "WINM26",
      side: "buy",
      quantity: 5,
      price: 170000,
      grossValue: 850000,
      dayTradeHint: false,
      maturity: "2027-01-15",
    });
  });

  it("aceita tradeList dentro de ticketInfo (formato documentado), com sinal pelo cV sem dC", () => {
    const legacy = {
      bmf: [
        {
          ticketInfo: {
            numeroNota: "1",
            dataPregao: "05/01/2026",
            tradeList: [
              {
                mercadoria: "CCMF25",
                cV: "V",
                dC: "",
                quantidade: 5,
                precoAjuste: 62.4,
                valorOperacao: 312,
                tipoNegocio: "NORMAL",
              },
            ],
          },
        },
      ],
    };
    const [note] = mapNotesPayload(legacy, "12345", "2026-01-05");
    expect(note.trades).toHaveLength(1);
    expect(note.trades[0]).toMatchObject({ ticker: "CCMF25", side: "sell" });
    expect(note.adjustments).toEqual([{ ticker: "CCMF25", value: -312 }]);
  });
});

describe("mapNotesPayload — loan", () => {
  it("mapeia movimentos de aluguel com datas ISO e invoice inteiro", () => {
    const payload = {
      loan: [
        {
          client: { account_number: "12345" },
          financial_summary: {},
          invoice_number: 987654,
          movement_date: "2026-01-05T00:00:00",
          movements: [
            {
              symbol: "PETR4",
              contract_side: "Doador",
              quantity: 300,
              fee: 0,
              remuneration: 12.4,
              irrf: 1.86,
            },
            {
              symbol: "VALE3",
              contract_side: "Tomador",
              quantity: 100,
              fee: 4.1,
              remuneration: 0,
              irrf: 0,
            },
          ],
        },
      ],
    };
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.market).toBe("loan");
    expect(note.noteNumber).toBe("987654");
    expect(note.date).toBe("2026-01-05");
    expect(note.loanLines).toEqual([
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
    ]);
    expect(note.irrf).toBe(1.86);
  });
});

describe("mapNotesPayloadWithRaw — rawPayload por nota (não por dia)", () => {
  const payload = {
    bov: [
      {
        ticketInfo: { numeroNota: "1", dataPregao: "05/01/2026" },
        tradeList: [
          {
            cV: "C",
            specTitulo: "PETR4\tPN",
            quantidade: 100,
            precoAjuste: 10,
            valorOperacao: 1000,
            tipoMercado: "VISTA",
          },
        ],
      },
      {
        ticketInfo: { numeroNota: "2", dataPregao: "05/01/2026" },
        tradeList: [
          {
            cV: "V",
            specTitulo: "VALE3\tON",
            quantidade: 50,
            precoAjuste: 60,
            valorOperacao: 3000,
            tipoMercado: "VISTA",
          },
        ],
      },
    ],
    loan: [
      {
        invoice_number: 999,
        movement_date: "2026-01-05",
        movements: [
          {
            symbol: "PETR4",
            contract_side: "Doador",
            quantity: 100,
            fee: 0,
            remuneration: 5,
            irrf: 0.75,
          },
        ],
      },
    ],
  };

  it("cada nota carrega só o próprio fragmento, não a resposta do dia inteiro", () => {
    const mapped = mapNotesPayloadWithRaw(payload, "12345", "2026-01-05");
    expect(mapped).toHaveLength(3);

    const petr4 = mapped.find((m) => m.note.noteNumber === "1");
    expect(petr4?.raw).toEqual({ bov: [payload.bov[0]] });
    // Não deve conter a nota "2" nem a de loan.
    expect(JSON.stringify(petr4?.raw)).not.toContain("VALE3");
    expect(JSON.stringify(petr4?.raw)).not.toContain("999");

    const vale3 = mapped.find((m) => m.note.noteNumber === "2");
    expect(vale3?.raw).toEqual({ bov: [payload.bov[1]] });

    const loan = mapped.find((m) => m.note.market === "loan");
    expect(loan?.raw).toEqual({ loan: [payload.loan[0]] });
  });

  it("o fragmento de cada nota, remapeado sozinho, reproduz a mesma nota (round-trip)", () => {
    const mapped = mapNotesPayloadWithRaw(payload, "12345", "2026-01-05");
    for (const { note, raw } of mapped) {
      const [remapped] = mapNotesPayload(raw, "12345", "2026-01-05");
      expect(remapped).toEqual(note);
    }
  });

  it("mapNotesPayload (sem raw) continua retornando as mesmas notas", () => {
    const withRaw = mapNotesPayloadWithRaw(payload, "12345", "2026-01-05").map(
      (m) => m.note,
    );
    const plain = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(plain).toEqual(withRaw);
  });
});

describe("mapPositionPayload — posição D-1 (renda variável)", () => {
  // Formato real do iaas-api-position observado em 2026-07: números como
  // string com ponto decimal, preço médio em AveragePrice.Price.
  const payload = {
    ContractVersion: "1.0",
    AccountNumber: "005259408",
    PositionDate: "2025-12-31T00:00:00",
    FixedIncome: [{ Ticker: "IGNORADO", Quantity: "10.0" }],
    Equities: [
      {
        ForwardPositions: [],
        OptionPositions: [
          {
            Ticker: "PETRB380",
            Quantity: "-100.0",
            AveragePrice: { Price: "0.55" },
          },
        ],
        StockPositions: [
          {
            Ticker: "VALE3",
            Quantity: "500.0",
            MarketPrice: "71.96",
            AveragePrice: { Price: "54.1369", Adjustable: "false" },
          },
          {
            Ticker: "BRAV3",
            Quantity: "1600.0",
            AveragePrice: { Price: "18.799012" },
          },
          // Zerada/incompleta: ignorada.
          { Ticker: "ZERO3", Quantity: "0.0" },
          { Quantity: "100.0" },
        ],
      },
    ],
  };

  it("extrai ações (bov) e opções (option) com quantidade assinada e preço médio", () => {
    expect(mapPositionPayload(payload)).toEqual([
      { ticker: "VALE3", market: "bov", quantity: 500, avgPrice: 54.1369 },
      { ticker: "BRAV3", market: "bov", quantity: 1600, avgPrice: 18.799012 },
      {
        ticker: "PETRB380",
        market: "option",
        quantity: -100,
        avgPrice: 0.55,
        // B = call de fevereiro; próximo vencimento após 31/12/2025.
        maturity: "2026-02-20",
      },
    ]);
  });

  it("opção real: MaturityDate da API vence a heurística e BuySell dá o sinal", () => {
    // Item real observado (conta 004122171, posição de 30/09/2025).
    const real = {
      PositionDate: "2025-09-30T00:00:00",
      Equities: [
        {
          StockPositions: [],
          OptionPositions: [
            {
              Ticker: "BPANL600",
              BuySell: "Comprada",
              Quantity: "10500.0",
              StrikePrice: "6.0",
              OptionType: "Call",
              MaturityDate: "2025-12-19T00:00:00Z",
              AveragePrice: { Price: "2.355746", Adjustable: "false" },
            },
            {
              Ticker: "VALEH894",
              BuySell: "Vendida",
              Quantity: "11000.0",
              MaturityDate: "2026-08-21T00:00:00Z",
              AveragePrice: { Price: "1.2" },
            },
          ],
        },
      ],
    };
    expect(mapPositionPayload(real)).toEqual([
      {
        ticker: "BPANL600",
        market: "option",
        quantity: 10500,
        avgPrice: 2.355746,
        maturity: "2025-12-19",
      },
      {
        ticker: "VALEH894",
        market: "option",
        quantity: -11000, // Vendida com Quantity positiva → short
        avgPrice: 1.2,
        maturity: "2026-08-21",
      },
    ]);
  });

  it("renda fixa/fundos ficam de fora; payload vazio vira lista vazia", () => {
    expect(mapPositionPayload({})).toEqual([]);
    expect(mapPositionPayload({ Equities: [] })).toEqual([]);
  });

  it("trimPositionPayload guarda só PositionDate + Equities", () => {
    const trimmed = trimPositionPayload(payload) as Record<string, unknown>;
    expect(Object.keys(trimmed).sort()).toEqual(["Equities", "PositionDate"]);
    // O bruto reduzido continua re-mapeável, com o mesmo resultado.
    expect(mapPositionPayload(trimmed)).toEqual(mapPositionPayload(payload));
  });
});

describe("deriveOptionExpiry — vencimento pelo ticker da série", () => {
  it("resolve mês pela letra (calls A–L, puts M–X) e ano pelo próximo vencimento", () => {
    // Séries reais da conta 004939149, referência 31/12/2025.
    expect(deriveOptionExpiry("BRAVS200", "2025-12-31")).toBe("2026-07-17"); // S = put jul
    expect(deriveOptionExpiry("VALEH894", "2025-12-31")).toBe("2026-08-21"); // H = call ago
    expect(deriveOptionExpiry("BBDCH20", "2025-12-31")).toBe("2026-08-21");
    // Mês já passado na data de referência → ano seguinte.
    expect(deriveOptionExpiry("PETRB280", "2025-12-31")).toBe("2026-02-20");
    // No próprio dia do vencimento ainda conta como passado (estritamente após).
    expect(deriveOptionExpiry("BRAVS200", "2026-07-17")).toBe("2027-07-16");
  });

  it("não deriva para tickers que não são série de opção", () => {
    expect(deriveOptionExpiry("VALE3", "2025-12-31")).toBeNull();
    expect(deriveOptionExpiry("ENGI11", "2025-12-31")).toBeNull();
    expect(deriveOptionExpiry("BRAVS200", "31/12/2025")).toBeNull(); // referência deve ser ISO
  });
});
