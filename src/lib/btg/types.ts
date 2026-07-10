/**
 * Tipos internos do domínio — desacoplados do formato do payload do BTG.
 * O mapper converte o payload bruto para estes tipos; o motor de apuração
 * só conhece estes tipos.
 */

export type Market = "bov" | "option" | "bmf" | "loan";
export type Side = "buy" | "sell";

/**
 * Exercício de opção (tipoMercado "EXERC OPC COMPRA/VENDA"): a linha é a
 * liquidação em ações ao strike; `optionTicker` é a série exercida (ticker da
 * linha sem o sufixo "E") e `underlying` o papel-objeto derivado da
 * especificação (raiz + ON→3/PN→4…), ou null quando não derivável.
 */
export interface ExerciseInfo {
  optionTicker: string;
  underlying: string | null;
}

export interface NormalizedTrade {
  ticker: string;
  side: Side;
  quantity: number;
  price: number;
  /** Valor financeiro do negócio, sempre positivo. */
  grossValue: number;
  /** Sinal auxiliar de day trade (obs "D" no bov/option, dC "D" no bmf). */
  dayTradeHint: boolean;
  /** Vencimento (ISO) — futuros (campo `vencimento`) e opções (3ª sexta do `prazo`). */
  maturity?: string;
  /** Presente quando a linha é exercício de opção. */
  exercise?: ExerciseInfo;
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

/**
 * Posição de renda variável em uma data (D-1 do período), semeada no motor
 * como posição inicial — vendas subsequentes realizam contra este preço médio.
 */
export interface InitialPosition {
  ticker: string;
  market: Market;
  /** Assinada: >0 comprado, <0 vendido. */
  quantity: number;
  avgPrice: number;
  /**
   * Vencimento (ISO) derivado do ticker da série (opções) — a posição não
   * traz prazo; sem isso, série que não negocia no período nunca venceria.
   */
  maturity?: string;
}

/** Resultado da consulta de posição (iaas-api-position) na API. */
export type FetchPositionResult =
  | { kind: "position"; raw: unknown; positions: InitialPosition[] }
  | { kind: "empty" };

/** Interface única — implementada pelo cliente real e pelo mock. */
export interface BtgService {
  fetchNotes(accountNumber: string, isoDate: string): Promise<FetchNotesResult>;
  fetchPosition(
    accountNumber: string,
    isoDate: string,
  ): Promise<FetchPositionResult>;
}
