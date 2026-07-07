import type { Market } from "@/lib/btg/types";

export type Modalidade = "day_trade" | "swing" | "mista" | "posicao";

export interface TickerResult {
  ticker: string;
  mercado: Market;
  modalidade: Modalidade;
  /** Nº de negócios executados no período. */
  operacoes: number;
  /** Quantidade total negociada. */
  quantidade: number;
  resultadoBruto: number;
  /** Ajustes diários de futuros (AJUPOS) atribuídos à mercadoria. */
  ajustesFuturos: number;
  custos: number;
  irrf: number;
  resultadoLiquido: number;
}

export interface CostBreakdown {
  corretagem: number;
  emolumentos: number;
  liquidacao: number;
  registro: number;
  iss: number;
  pis: number;
  cofins: number;
  outros: number;
  irrf: number;
  total: number;
}

export interface TickerCosts extends CostBreakdown {
  ticker: string;
}

export interface DailyPoint {
  /** Data do pregão (ISO). */
  date: string;
  /** Resultado realizado do dia (day trade + swing), líquido de custos. */
  resultado: number;
  ajustesFuturos: number;
  aluguel: number;
  total: number;
  acumulado: number;
}

export interface OpenPosition {
  ticker: string;
  mercado: Market;
  side: "comprado" | "vendido";
  quantidade: number;
  precoMedio: number;
}

export interface AluguelSummary {
  taxas: number;
  remuneracao: number;
  irrf: number;
  liquido: number;
}

export interface Totals {
  resultadoLiquido: number;
  resultadoBruto: number;
  custos: number;
  irrf: number;
  /** Nº total de negócios do período. */
  operacoes: number;
  operacoesFechadas: number;
  /** % de operações fechadas com resultado líquido positivo (0–100). */
  taxaAcerto: number;
}

export interface ConsolidatedResult {
  porTicker: TickerResult[];
  custosPorTicker: TickerCosts[];
  custosTotais: CostBreakdown;
  serieDiaria: DailyPoint[];
  posicoesAbertas: OpenPosition[];
  aluguel: AluguelSummary;
  totais: Totals;
  alertas: string[];
}
