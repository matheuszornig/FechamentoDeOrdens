import * as XLSX from "xlsx";
import type { ConsolidatedResult } from "@/lib/apuracao/types";
import type { NormalizedNote } from "@/lib/btg/types";

const MERCADO_LABEL: Record<string, string> = {
  bov: "Ações",
  option: "Opções",
  bmf: "Futuros",
  loan: "Aluguel",
};

/**
 * Gera a planilha de auditoria: uma aba por dimensão dos dados (negócios,
 * ajustes de futuros, aluguel, custos por nota) mais as abas que refletem o
 * resultado consolidado (por ticker, custos por ticker, série diária,
 * posições abertas). Números ficam crus (não formatados como moeda) de
 * propósito — é material para conferência e cálculo em planilha, não para
 * leitura em tela.
 */
export function buildAuditWorkbook(
  accountNumber: string,
  startDate: string,
  endDate: string,
  notes: NormalizedNote[],
  result: ConsolidatedResult,
): Uint8Array {
  const wb = XLSX.utils.book_new();

  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // --- Resumo ------------------------------------------------------------
  const resumoRows = [
    { Campo: "Conta", Valor: accountNumber },
    { Campo: "Período (início)", Valor: startDate },
    { Campo: "Período (fim)", Valor: endDate },
    { Campo: "Gerado em", Valor: new Date().toISOString() },
    { Campo: "", Valor: "" },
    { Campo: "Resultado líquido", Valor: result.totais.resultadoLiquido },
    { Campo: "Resultado bruto", Valor: result.totais.resultadoBruto },
    { Campo: "Custos totais", Valor: result.totais.custos },
    { Campo: "IRRF total", Valor: result.totais.irrf },
    { Campo: "Operações totais", Valor: result.totais.operacoes },
    { Campo: "Operações fechadas", Valor: result.totais.operacoesFechadas },
    { Campo: "Taxa de acerto (%)", Valor: result.totais.taxaAcerto },
    { Campo: "", Valor: "" },
    { Campo: "Aluguel — remuneração", Valor: result.aluguel.remuneracao },
    { Campo: "Aluguel — taxas", Valor: result.aluguel.taxas },
    { Campo: "Aluguel — IRRF", Valor: result.aluguel.irrf },
    { Campo: "Aluguel — líquido", Valor: result.aluguel.liquido },
  ];
  addSheet("Resumo", resumoRows);

  // --- Negócios (uma linha por trade, todas as notas do período) --------
  const negocios = notes.flatMap((note) =>
    note.trades.map((t) => ({
      Data: note.date,
      Mercado: MERCADO_LABEL[note.market] ?? note.market,
      "Nº Nota": note.noteNumber,
      Ticker: t.ticker,
      Lado: t.side === "buy" ? "Compra" : "Venda",
      Quantidade: t.quantity,
      Preço: t.price,
      "Valor Bruto": t.grossValue,
      "Day Trade": t.dayTradeHint ? "Sim" : "Não",
      Vencimento: t.maturity ?? "",
      "Exercício de Opção": t.exercise ? t.exercise.optionTicker : "",
      "Papel-Objeto": t.exercise ? (t.exercise.underlying ?? "") : "",
    })),
  );
  addSheet("Negócios", negocios);

  // --- Ajustes diários de futuros (AJUPOS) --------------------------------
  const ajustes = notes.flatMap((note) =>
    note.adjustments.map((adj) => ({
      Data: note.date,
      "Nº Nota": note.noteNumber,
      Ticker: adj.ticker,
      Valor: adj.value,
    })),
  );
  if (ajustes.length > 0) addSheet("Ajustes Futuros", ajustes);

  // --- Aluguel (BTC) -------------------------------------------------------
  const aluguel = notes.flatMap((note) =>
    note.loanLines.map((line) => ({
      Data: note.date,
      "Nº Nota": note.noteNumber,
      Ativo: line.symbol,
      Lado: line.side === "doador" ? "Doador" : "Tomador",
      Quantidade: line.quantity,
      Taxa: line.fee,
      Remuneração: line.remuneration,
      IRRF: line.irrf,
    })),
  );
  if (aluguel.length > 0) addSheet("Aluguel", aluguel);

  // --- Custos por nota -----------------------------------------------------
  const custosPorNota = notes.map((note) => ({
    Data: note.date,
    Mercado: MERCADO_LABEL[note.market] ?? note.market,
    "Nº Nota": note.noteNumber,
    Corretagem: note.costs.corretagem,
    Emolumentos: note.costs.emolumentos,
    Liquidação: note.costs.liquidacao,
    Registro: note.costs.registro,
    ISS: note.costs.iss,
    PIS: note.costs.pis,
    COFINS: note.costs.cofins,
    Outros: note.costs.outros,
    IRRF: note.irrf,
  }));
  addSheet("Custos por Nota", custosPorNota);

  // --- Resultado por ticker (mesmo cálculo exibido na tela) ---------------
  const porTicker = result.porTicker.map((t) => ({
    Ticker: t.ticker,
    Mercado: MERCADO_LABEL[t.mercado] ?? t.mercado,
    Operações: t.operacoes,
    Quantidade: t.quantidade,
    "Quantidade Fechada": t.quantidadeFechada,
    "PM Compra": t.precoMedioCompra,
    "PM Venda": t.precoMedioVenda,
    "Resultado Bruto": t.resultadoBruto,
    "Ajustes de Futuros": t.ajustesFuturos,
    Custos: t.custos,
    IRRF: t.irrf,
    "Resultado Líquido": t.resultadoLiquido,
  }));
  addSheet("Resultado por Ticker", porTicker);

  // --- Custos por ticker -----------------------------------------------------
  const custosPorTicker = result.custosPorTicker.map((c) => ({
    Ticker: c.ticker,
    Corretagem: c.corretagem,
    Emolumentos: c.emolumentos,
    Liquidação: c.liquidacao,
    Registro: c.registro,
    ISS: c.iss,
    PIS: c.pis,
    COFINS: c.cofins,
    Outros: c.outros,
    IRRF: c.irrf,
    Total: c.total,
  }));
  addSheet("Custos por Ticker", custosPorTicker);

  // --- Série diária de P/L ---------------------------------------------------
  const serieDiaria = result.serieDiaria.map((p) => ({
    Data: p.date,
    "Resultado do Dia": p.resultado,
    "Ajustes de Futuros": p.ajustesFuturos,
    Aluguel: p.aluguel,
    Total: p.total,
    Acumulado: p.acumulado,
  }));
  addSheet("Série Diária", serieDiaria);

  // --- Posições em aberto ao fim do período -----------------------------
  const posicoesAbertas = result.posicoesAbertas.map((p) => ({
    Ticker: p.ticker,
    Mercado: MERCADO_LABEL[p.mercado] ?? p.mercado,
    Lado: p.side === "comprado" ? "Comprado" : "Vendido",
    Quantidade: p.quantidade,
    "Preço Médio": p.precoMedio,
  }));
  if (posicoesAbertas.length > 0) addSheet("Posições Abertas", posicoesAbertas);

  // --- Alertas de validação cruzada ---------------------------------------
  if (result.alertas.length > 0) {
    addSheet(
      "Alertas",
      result.alertas.map((a) => ({ Alerta: a })),
    );
  }

  // type "array" retorna ArrayBuffer em runtime — normaliza para Uint8Array,
  // que o route fatia em chunks para a resposta em streaming.
  // compression: xlsx é um ZIP; sem isso o SheetJS grava sem comprimir e uma
  // conta volumosa gera dezenas de MB (139k negócios ≈ 64MB → ~17MB).
  const bytes = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }) as ArrayBuffer | Uint8Array;
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}
