import { describe, expect, it } from "vitest";
import {
  mapNotesPayload,
  normalizeCost,
  normalizeDoc,
  parseBrDate,
  parseTicker,
  toNumber,
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

  it("ignora placeholders 'string' sem falhar", () => {
    expect(toNumber("string")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(12.5)).toBe(12.5);
    expect(toNumber("1.234,56")).toBe(1234.56);
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
    expect(note.summary).toEqual([{ ticker: "AMER3", quantity: 200, value: 2100 }]);
  });

  it("aceita campos extras sem falhar (schema tolerante)", () => {
    const extra = structuredClone(payload) as Record<string, unknown>;
    (extra.bov as Record<string, unknown>[])[0].campoNovoDoBtg = { qualquer: 1 };
    expect(() => mapNotesPayload(extra, "12345", "2026-01-05")).not.toThrow();
  });
});

describe("mapNotesPayload — bmf", () => {
  const payload = {
    bmf: [
      {
        financialSummary: {
          bmf_fee: -1.5,
          registry_fee: -0.8,
          operational_fee: -4.0,
          iss: -0.2,
          pis: -0.03,
          cofins: -0.12,
          cvm179_fee: -0.05,
          total_fees: -6.7,
          daytrade_adjustment: 150,
          position_adjustment: -320.5,
          total_net: -177.2,
        },
        ticketInfo: {
          numeroNota: "778899",
          dataPregao: "05/01/2026",
          codCliente: "12345",
          tradeList: [
            {
              mercadoria: "CCMF25",
              cV: "C",
              dC: "D",
              quantidade: 5,
              precoAjuste: 62.1,
              valorOperacao: 139725,
              vencimento: "15/01/2027",
              tipoNegocio: "NORMAL",
            },
            {
              mercadoria: "CCMF25",
              cV: "V",
              dC: "D",
              quantidade: 5,
              precoAjuste: 62.4,
              valorOperacao: 140400,
              vencimento: "15/01/2027",
              tipoNegocio: "NORMAL",
            },
            {
              mercadoria: "WINQ25",
              cV: "V",
              dC: "",
              quantidade: 2,
              precoAjuste: 0,
              valorOperacao: 320.5,
              vencimento: "18/08/2026",
              tipoNegocio: "AJUPOS",
            },
          ],
        },
      },
    ],
  };

  it("custos negativos do financialSummary viram positivos", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.costs.corretagem).toBe(4.0);
    expect(note.costs.emolumentos).toBe(1.5);
    expect(note.costs.registro).toBe(0.8);
    expect(note.costs.outros).toBe(0.05);
  });

  it("AJUPOS vira ajuste financeiro fora do matching, com sinal pelo lado", () => {
    const [note] = mapNotesPayload(payload, "12345", "2026-01-05");
    expect(note.trades).toHaveLength(2); // só os NORMAL
    expect(note.adjustments).toEqual([{ ticker: "WINQ25", value: -320.5 }]);
    expect(note.trades[0]).toMatchObject({
      ticker: "CCMF25",
      side: "buy",
      dayTradeHint: true,
      maturity: "2027-01-15",
    });
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
