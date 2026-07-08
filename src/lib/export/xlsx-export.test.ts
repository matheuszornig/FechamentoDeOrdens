import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { apurar } from "@/lib/apuracao/engine";
import { EMPTY_COSTS, type NormalizedNote } from "@/lib/btg/types";
import { buildAuditWorkbook } from "./xlsx-export";

function sheetRows(wb: XLSX.WorkBook, name: string) {
  const ws = wb.Sheets[name];
  return ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) : null;
}

describe("buildAuditWorkbook", () => {
  const notes: NormalizedNote[] = [
    {
      accountNumber: "12345",
      date: "2026-01-05",
      market: "bov",
      noteNumber: "111",
      trades: [
        {
          ticker: "PETR4",
          side: "buy",
          quantity: 100,
          price: 10,
          grossValue: 1000,
          dayTradeHint: true,
        },
        {
          ticker: "PETR4",
          side: "sell",
          quantity: 100,
          price: 11,
          grossValue: 1100,
          dayTradeHint: true,
        },
      ],
      adjustments: [],
      loanLines: [],
      costs: { ...EMPTY_COSTS, corretagem: 5 },
      irrf: 0.5,
      summary: [],
    },
    {
      accountNumber: "12345",
      date: "2026-01-06",
      market: "loan",
      noteNumber: "222",
      trades: [],
      adjustments: [],
      loanLines: [
        {
          symbol: "PETR4",
          side: "doador",
          quantity: 100,
          fee: 0,
          remuneration: 10,
          irrf: 1.5,
        },
      ],
      costs: { ...EMPTY_COSTS },
      irrf: 1.5,
      summary: [],
    },
  ];

  const result = apurar(notes, { endDate: "2026-01-06" });

  it("gera um workbook lível com as abas esperadas", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });

    expect(wb.SheetNames).toEqual(
      expect.arrayContaining([
        "Resumo",
        "Negócios",
        "Aluguel",
        "Custos por Nota",
        "Resultado por Ticker",
        "Custos por Ticker",
        "Série Diária",
      ]),
    );
    // Sem ajustes de futuros nem alertas neste cenário — abas omitidas.
    expect(wb.SheetNames).not.toContain("Ajustes Futuros");
    expect(wb.SheetNames).not.toContain("Alertas");
  });

  it("aba Negócios lista um negócio por linha, com os campos de auditoria", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });
    const rows = sheetRows(wb, "Negócios");
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({
      Data: "2026-01-05",
      Ticker: "PETR4",
      Lado: "Compra",
      Quantidade: 100,
      Preço: 10,
      "Valor Bruto": 1000,
      "Day Trade": "Sim",
    });
  });

  it("aba Resultado por Ticker inclui PM compra/venda calculados pelo motor", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });
    const rows = sheetRows(wb, "Resultado por Ticker");
    expect(rows?.[0]).toMatchObject({
      Ticker: "PETR4",
      "PM Compra": 10,
      "PM Venda": 11,
      "Resultado Líquido": 95, // 100 × (11-10) − 5 de corretagem
    });
  });

  it("aba Aluguel reflete as linhas de loan da nota", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });
    const rows = sheetRows(wb, "Aluguel");
    expect(rows).toEqual([
      {
        Data: "2026-01-06",
        "Nº Nota": "222",
        Ativo: "PETR4",
        Lado: "Doador",
        Quantidade: 100,
        Taxa: 0,
        Remuneração: 10,
        IRRF: 1.5,
      },
    ]);
  });

  it("aba Resumo traz conta, período e totais", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });
    const rows = sheetRows(wb, "Resumo");
    expect(rows?.some((r) => r.Campo === "Conta" && r.Valor === "12345")).toBe(
      true,
    );
    expect(
      rows?.some(
        (r) =>
          r.Campo === "Resultado líquido" &&
          r.Valor === result.totais.resultadoLiquido,
      ),
    ).toBe(true);
  });

  it("omite abas vazias (ajustes de futuros, posições abertas, alertas)", () => {
    const bytes = buildAuditWorkbook(
      "12345",
      "2026-01-05",
      "2026-01-06",
      notes,
      result,
    );
    const wb = XLSX.read(bytes, { type: "array" });
    expect(sheetRows(wb, "Posições Abertas")).toBeNull();
  });
});
