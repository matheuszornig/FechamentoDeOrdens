import {
  type BmfNote,
  type BovNote,
  type BrokerageNotesResponse,
  brokerageNotesResponseSchema,
  type LoanNote,
} from "./schemas";
import {
  EMPTY_COSTS,
  type FutureAdjustment,
  type LoanLine,
  type Market,
  type NormalizedNote,
  type NormalizedTrade,
  type SummaryLine,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers de normalização (todos tolerantes a placeholders "string" da doc)
// ---------------------------------------------------------------------------

/** "05/01/2026" → "2026-01-05". Datas ISO ("2026-01-05[T...]") passam direto. */
export function parseBrDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "string") return null;
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** `"AMER3\tON"` → `"AMER3"`. Sem tab, retorna o valor com trim. */
export function parseTicker(specTitulo: unknown): string | null {
  if (typeof specTitulo !== "string" || specTitulo === "string") return null;
  const ticker = specTitulo.split("\t")[0]?.trim();
  return ticker || null;
}

/** Converte para número; placeholders "string", null e NaN viram 0. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    if (value === "string" || value.trim() === "") return 0;
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
    const direct = Number(value);
    return Number.isFinite(direct) ? direct : 0;
  }
  return 0;
}

/**
 * Normaliza um custo usando o indicador D/C: débito ("D") é custo positivo,
 * crédito ("C") é estorno (negativo). Sem indicador, usa o valor absoluto —
 * custos internos são sempre positivos.
 */
export function normalizeCost(value: unknown, dcText?: unknown): number {
  const abs = Math.abs(toNumber(value));
  if (typeof dcText === "string" && dcText.trim().toUpperCase() === "C") {
    return -abs;
  }
  return abs;
}

/** CPF/CNPJ com máscara → apenas dígitos. */
export function normalizeDoc(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// bov / option (mesma estrutura)
// ---------------------------------------------------------------------------

function mapBovNote(
  note: BovNote,
  market: Market,
  accountNumber: string,
  fallbackDate: string,
): NormalizedNote | null {
  const info = note.ticketInfo ?? {};
  const date = parseBrDate(info.dataPregao) ?? fallbackDate;
  const noteNumber = String(info.numeroNota ?? "").trim();

  const trades: NormalizedTrade[] = [];
  for (const t of note.tradeList ?? []) {
    const ticker = parseTicker(t.specTitulo);
    const quantity = toNumber(t.quantidade);
    if (!ticker || quantity <= 0) continue;
    const price = toNumber(t.precoAjuste);
    const grossValue = Math.abs(toNumber(t.valorOperacao)) || quantity * price;
    trades.push({
      ticker,
      side: String(t.cV).trim().toUpperCase() === "V" ? "sell" : "buy",
      quantity,
      price,
      grossValue,
      dayTradeHint: String(t.obs ?? "").trim().toUpperCase() === "D",
    });
  }

  const summary: SummaryLine[] = [];
  for (const s of note.summarizedTradeList ?? []) {
    const ticker = parseTicker(s.specTitulo);
    if (!ticker) continue;
    summary.push({
      ticker,
      quantity: Math.abs(toNumber(s.quantidade)),
      value: Math.abs(toNumber(s.valorOperacao)),
    });
  }

  if (trades.length === 0 && !noteNumber) return null;

  return {
    accountNumber,
    date,
    market,
    noteNumber: noteNumber || `sem-numero-${date}`,
    trades,
    adjustments: [],
    loanLines: [],
    costs: {
      corretagem: normalizeCost(info.correDataTotal, info.correDataTotalText),
      emolumentos: normalizeCost(info.bolsaDataEmol, info.bolsaDataEmolText),
      liquidacao: normalizeCost(info.clearDataTaxaLiq, info.clearDataTaxaLiqText),
      registro: normalizeCost(info.clearDataTaxaReg, info.clearDataTaxaRegText),
      iss: normalizeCost(info.correDataIss, info.correDataIssText),
      pis: normalizeCost(info.pis),
      cofins: normalizeCost(info.cofins),
      outros: normalizeCost(info.correDataTTA, info.correDataTTAText),
    },
    irrf: normalizeCost(info.correDataIrrf, info.correDataIrrfText),
    summary,
  };
}

// ---------------------------------------------------------------------------
// bmf (futuros) — AJUPOS vira ajuste financeiro, fora do matching
// ---------------------------------------------------------------------------

function mapBmfNote(
  note: BmfNote,
  accountNumber: string,
  fallbackDate: string,
): NormalizedNote | null {
  const info = note.ticketInfo ?? {};
  const fin = note.financialSummary ?? {};
  const date = parseBrDate(info.dataPregao) ?? fallbackDate;
  const noteNumber = String(info.numeroNota ?? "").trim();

  const trades: NormalizedTrade[] = [];
  const adjustments: FutureAdjustment[] = [];

  for (const t of info.tradeList ?? []) {
    const ticker =
      typeof t.mercadoria === "string" && t.mercadoria !== "string"
        ? t.mercadoria.trim()
        : null;
    if (!ticker) continue;
    const rawValue = toNumber(t.valorOperacao);

    if (String(t.tipoNegocio ?? "").trim().toUpperCase() === "AJUPOS") {
      // Ajuste diário de posição: não é abertura/fechamento. Valor já vem
      // assinado; se vier absoluto, o lado "V" indica débito ao cliente.
      const value =
        rawValue < 0
          ? rawValue
          : String(t.cV).trim().toUpperCase() === "V"
            ? -rawValue
            : rawValue;
      adjustments.push({ ticker, value: round2(value) });
      continue;
    }

    const quantity = toNumber(t.quantidade);
    if (quantity <= 0) continue;
    const price = toNumber(t.precoAjuste);
    trades.push({
      ticker,
      side: String(t.cV).trim().toUpperCase() === "V" ? "sell" : "buy",
      quantity,
      price,
      grossValue: Math.abs(rawValue) || quantity * price,
      dayTradeHint: String(t.dC ?? "").trim().toUpperCase() === "D",
      maturity: parseBrDate(t.vencimento) ?? undefined,
    });
  }

  if (trades.length === 0 && adjustments.length === 0 && !noteNumber) return null;

  // financialSummary do bmf traz custos com sinal negativo → abs.
  return {
    accountNumber,
    date,
    market: "bmf",
    noteNumber: noteNumber || `sem-numero-${date}`,
    trades,
    adjustments,
    loanLines: [],
    costs: {
      corretagem: Math.abs(toNumber(fin.operational_fee)),
      emolumentos: Math.abs(toNumber(fin.bmf_fee)),
      liquidacao: 0,
      registro: Math.abs(toNumber(fin.registry_fee)),
      iss: Math.abs(toNumber(fin.iss)),
      pis: Math.abs(toNumber(fin.pis)),
      cofins: Math.abs(toNumber(fin.cofins)),
      outros: Math.abs(toNumber(fin.cvm179_fee)),
    },
    irrf: 0,
    summary: [],
  };
}

// ---------------------------------------------------------------------------
// loan (aluguel/BTC) — fora do matching, linha separada de custos/remuneração
// ---------------------------------------------------------------------------

function mapLoanNote(
  note: LoanNote,
  accountNumber: string,
  fallbackDate: string,
): NormalizedNote | null {
  const date = parseBrDate(note.movement_date) ?? fallbackDate;
  // invoice_number do loan é inteiro (diferente dos demais mercados).
  const noteNumber = String(note.invoice_number ?? "").trim();

  const loanLines: LoanLine[] = [];
  for (const m of note.movements ?? []) {
    const symbol =
      typeof m.symbol === "string" && m.symbol !== "string" ? m.symbol.trim() : null;
    if (!symbol) continue;
    loanLines.push({
      symbol,
      side: String(m.contract_side ?? "")
        .trim()
        .toLowerCase()
        .startsWith("d")
        ? "doador"
        : "tomador",
      quantity: Math.abs(toNumber(m.quantity)),
      fee: Math.abs(toNumber(m.fee)),
      remuneration: Math.abs(toNumber(m.remuneration)),
      irrf: Math.abs(toNumber(m.irrf)),
    });
  }

  if (loanLines.length === 0 && !noteNumber) return null;

  return {
    accountNumber,
    date,
    market: "loan",
    noteNumber: noteNumber || `sem-numero-${date}`,
    trades: [],
    adjustments: [],
    loanLines,
    costs: { ...EMPTY_COSTS },
    irrf: loanLines.reduce((acc, l) => acc + l.irrf, 0),
    summary: [],
  };
}

// ---------------------------------------------------------------------------
// Entrada única
// ---------------------------------------------------------------------------

/**
 * Converte o payload bruto (resposta 200 da API) em NormalizedNote[].
 * `fallbackDate` (ISO) é a data consultada — usada quando a nota não traz
 * dataPregao válida.
 */
export function mapNotesPayload(
  payload: unknown,
  accountNumber: string,
  fallbackDate: string,
): NormalizedNote[] {
  const parsed: BrokerageNotesResponse = brokerageNotesResponseSchema.parse(
    payload ?? {},
  );
  const notes: NormalizedNote[] = [];

  for (const n of parsed.bov ?? []) {
    const mapped = mapBovNote(n, "bov", accountNumber, fallbackDate);
    if (mapped) notes.push(mapped);
  }
  for (const n of parsed.option ?? []) {
    const mapped = mapBovNote(n, "option", accountNumber, fallbackDate);
    if (mapped) notes.push(mapped);
  }
  for (const n of parsed.bmf ?? []) {
    const mapped = mapBmfNote(n, accountNumber, fallbackDate);
    if (mapped) notes.push(mapped);
  }
  for (const n of parsed.loan ?? []) {
    const mapped = mapLoanNote(n, accountNumber, fallbackDate);
    if (mapped) notes.push(mapped);
  }

  return notes;
}
