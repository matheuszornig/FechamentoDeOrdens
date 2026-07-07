/**
 * Tipos internos do domínio — desacoplados do formato do payload do BTG.
 * O mapper converte o payload bruto para estes tipos; o motor de apuração
 * só conhece estes tipos.
 */

export type Market = "bov" | "option" | "bmf" | "loan";
export type Side = "buy" | "sell";

export interface NormalizedTrade {
  ticker: string;
  side: Side;
  quantity: number;
  price: number;
  /** Valor financeiro do negócio, sempre positivo. */
  grossValue: number;
  /** Sinal auxiliar de day trade (obs "D" no bov/option, dC "D" no bmf). */
  dayTradeHint: boolean;
  /** Vencimento (ISO) — apenas futuros. */
  maturity?: string;
}

/** Ajuste diário de posição de futuros (tipoNegocio AJUPOS) — fora do matching. */
export interface FutureAdjustment {
  ticker: string;
  /** Positivo = crédito ao cliente; negativo = débito. */
  value: number;
}

export interface LoanLine {
  symbol: string;
  side: "tomador" | "doador";
  quantity: number;
  /** Custo (taxa) — positivo. */
  fee: number;
  /** Remuneração recebida — positivo. */
  remuneration: number;
  irrf: number;
}

/** Custos da nota, sempre positivos internamente. */
export interface NoteCosts {
  corretagem: number;
  emolumentos: number;
  liquidacao: number;
  registro: number;
  iss: number;
  pis: number;
  cofins: number;
  /** TTA, taxa operacional, CVM 179 etc. */
  outros: number;
}

export const EMPTY_COSTS: NoteCosts = {
  corretagem: 0,
  emolumentos: 0,
  liquidacao: 0,
  registro: 0,
  iss: 0,
  pis: 0,
  cofins: 0,
  outros: 0,
};

/** Linha do consolidado por título da nota (summarizedTradeList) — usada em validação cruzada. */
export interface SummaryLine {
  ticker: string;
  quantity: number;
  value: number;
}

export interface NormalizedNote {
  accountNumber: string;
  /** Data do pregão em ISO (YYYY-MM-DD). */
  date: string;
  market: Market;
  noteNumber: string;
  trades: NormalizedTrade[];
  adjustments: FutureAdjustment[];
  loanLines: LoanLine[];
  costs: NoteCosts;
  irrf: number;
  summary: SummaryLine[];
}

/** Resultado da consulta de notas de um dia na API. */
export type FetchNotesResult =
  | { kind: "notes"; raw: unknown; notes: NormalizedNote[] }
  | { kind: "empty" };

/** Interface única — implementada pelo cliente real e pelo mock. */
export interface BtgService {
  fetchNotes(accountNumber: string, isoDate: string): Promise<FetchNotesResult>;
}
