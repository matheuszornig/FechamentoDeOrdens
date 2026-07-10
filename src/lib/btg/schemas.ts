import { z } from "zod";

/**
 * Schemas Zod tolerantes (loose: campos extras passam) para o payload real da
 * API de notas do BTG. A validação estrutural fica aqui; coerções de formato
 * (datas DD/MM/YYYY, "\t" no specTitulo, sinais D/C, placeholders "string")
 * ficam no mapper.
 */

/** Aceita number, string numérica, placeholder "string" ou campo ausente. */
export const tolerantNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional();

export const bovTradeSchema = z.looseObject({
  cV: z.string().optional(),
  specTitulo: z.string().optional(),
  quantidade: tolerantNumber,
  precoAjuste: tolerantNumber,
  valorOperacao: tolerantNumber,
  tipoMercado: z.string().optional(),
  obs: z.string().nullish(),
  /** Vencimento da opção no formato "MM/YY". */
  prazo: z.string().optional(),
});

export const bovTicketInfoSchema = z.looseObject({
  numeroNota: z.union([z.string(), z.number()]).optional(),
  dataPregao: z.string().optional(),
  dataLiqui: z.string().optional(),
  numeroCliente: z.union([z.string(), z.number()]).optional(),
  codCliente: z.union([z.string(), z.number()]).optional(),
  docCliente: z.string().optional(),
  bolsaDataEmol: tolerantNumber,
  clearDataTaxaLiq: tolerantNumber,
  clearDataTaxaReg: tolerantNumber,
  correDataTotal: tolerantNumber,
  correDataIss: tolerantNumber,
  correDataIrrf: tolerantNumber,
  correDataTTA: tolerantNumber,
  pis: tolerantNumber,
  cofins: tolerantNumber,
  // Indicadores D/C — nomes previstos na doc…
  bolsaDataEmolText: z.string().optional(),
  clearDataTaxaLiqText: z.string().optional(),
  clearDataTaxaRegText: z.string().optional(),
  correDataTotalText: z.string().optional(),
  correDataIssText: z.string().optional(),
  correDataIrrfText: z.string().optional(),
  correDataTTAText: z.string().optional(),
  // …e nomes observados no payload real da API.
  bolsaTextEmol: z.string().optional(),
  clearTextTaxaLiq: z.string().optional(),
  clearTextTaxaReg: z.string().optional(),
  correTextTotal: z.string().optional(),
  correTextIss: z.string().optional(),
  correTextIrrf: z.string().optional(),
  correTextTTA: z.string().optional(),
});

/** Formato da doc (specTitulo/quantidade) e formato real (titulo + totais por lado). */
export const bovSummarizedTradeSchema = z.looseObject({
  specTitulo: z.string().optional(),
  quantidade: tolerantNumber,
  valorOperacao: tolerantNumber,
  titulo: z.string().optional(),
  quantidadeTotalCompra: tolerantNumber,
  quantidadeTotalVenda: tolerantNumber,
  valorTotalCompra: tolerantNumber,
  valorTotalVenda: tolerantNumber,
});

/** Estrutura compartilhada por `bov` (ações à vista) e `option` (opções). */
export const bovNoteSchema = z.looseObject({
  ticketInfo: bovTicketInfoSchema.optional(),
  tradeList: z.array(bovTradeSchema).optional(),
  summarizedTradeList: z.array(bovSummarizedTradeSchema).optional(),
});

export const bmfTradeSchema = z.looseObject({
  mercadoria: z.string().optional(),
  cV: z.string().optional(),
  dC: z.string().optional(),
  quantidade: tolerantNumber,
  precoAjuste: tolerantNumber,
  valorOperacao: tolerantNumber,
  vencimento: z.string().optional(),
  tipoNegocio: z.string().optional(),
});

export const bmfFinancialSummarySchema = z.looseObject({
  bmf_fee: tolerantNumber,
  registry_fee: tolerantNumber,
  operational_fee: tolerantNumber,
  clearing: tolerantNumber,
  iss: tolerantNumber,
  pis: tolerantNumber,
  cofins: tolerantNumber,
  cvm179_fee: tolerantNumber,
  other_fees: tolerantNumber,
  total_fees: tolerantNumber,
  daytrade_adjustment: tolerantNumber,
  position_adjustment: tolerantNumber,
  total_net: tolerantNumber,
});

/** Payload real traz `tradeList` no topo da nota; o documentado, dentro de ticketInfo. */
export const bmfNoteSchema = z.looseObject({
  financialSummary: bmfFinancialSummarySchema.optional(),
  tradeList: z.array(bmfTradeSchema).optional(),
  ticketInfo: z
    .looseObject({
      numeroNota: z.union([z.string(), z.number()]).optional(),
      dataPregao: z.string().optional(),
      codCliente: z.union([z.string(), z.number()]).optional(),
      irrf: tolerantNumber,
      irrfDayTrade: tolerantNumber,
      tradeList: z.array(bmfTradeSchema).optional(),
    })
    .optional(),
});

export const loanMovementSchema = z.looseObject({
  symbol: z.string().optional(),
  contract_side: z.string().optional(),
  quantity: tolerantNumber,
  fee: tolerantNumber,
  remuneration: tolerantNumber,
  irrf: tolerantNumber,
});

export const loanNoteSchema = z.looseObject({
  client: z
    .looseObject({
      account_number: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  financial_summary: z.looseObject({}).optional(),
  invoice_number: z.union([z.number(), z.string()]).optional(),
  movement_date: z.string().optional(),
  movements: z.array(loanMovementSchema).optional(),
});

export const brokerageNotesResponseSchema = z.looseObject({
  loan: z.array(loanNoteSchema).nullish(),
  bmf: z.array(bmfNoteSchema).nullish(),
  bov: z.array(bovNoteSchema).nullish(),
  option: z.array(bovNoteSchema).nullish(),
});

export type BovTrade = z.infer<typeof bovTradeSchema>;
export type BovNote = z.infer<typeof bovNoteSchema>;
export type BmfTrade = z.infer<typeof bmfTradeSchema>;
export type BmfNote = z.infer<typeof bmfNoteSchema>;
export type LoanNote = z.infer<typeof loanNoteSchema>;
export type BrokerageNotesResponse = z.infer<
  typeof brokerageNotesResponseSchema
>;

/**
 * Posição (iaas-api-position). Só a renda variável interessa: Equities traz
 * StockPositions/OptionPositions com Ticker, Quantity e AveragePrice.Price
 * (formato real observado em 2026-07: números como string com ponto decimal).
 */
export const equityPositionItemSchema = z.looseObject({
  Ticker: z.string().optional(),
  Quantity: tolerantNumber,
  AveragePrice: z
    .looseObject({
      Price: tolerantNumber,
    })
    .nullish(),
});

export const equitiesSectionSchema = z.looseObject({
  StockPositions: z.array(equityPositionItemSchema).nullish(),
  OptionPositions: z.array(equityPositionItemSchema).nullish(),
});

export const positionResponseSchema = z.looseObject({
  PositionDate: z.string().optional(),
  Equities: z.array(equitiesSectionSchema).nullish(),
});

export type EquityPositionItem = z.infer<typeof equityPositionItemSchema>;
export type PositionResponse = z.infer<typeof positionResponseSchema>;
