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
  /**
   * Quantidade efetivamente fechada no período (day trade + fechamentos de
   * swing/exercício/vencimento) — ex.: 1000 compradas e 500 vendidas geram
   * 500 de quantidade fechada.
   */
  quantidadeFechada: number;
  /** Preço médio das compras do período (null sem compras). */
  precoMedioCompra: number | null;
  /** Preço médio das vendas do período (null sem vendas). */
  precoMedioVenda: number | null;
  resultadoBruto: number;
  /**
   * Financeiro de futuros da mercadoria: ajustes diários (AJUPOS) + liquidação
   * dos negócios contra o ajuste do dia — é o resultado de bmf em reais.
   */
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
