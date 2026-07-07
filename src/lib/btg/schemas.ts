import { z } from "zod";

/**
 * Schemas Zod tolerantes (loose: campos extras passam) para o payload real da
 * API de notas do BTG. A validação estrutural fica aqui; coerções de formato
 * (datas DD/MM/YYYY, "\t" no specTitulo, sinais D/C, placeholders "string")
 * ficam no mapper.
 */

/** Aceita number, string numérica ou placeholder "string" (docs do BTG). */
export const tolerantNumber = z.union([z.number(), z.string(), z.null(), z.undefined()]);

export const bovTradeSchema = z.looseObject({
  cV: z.string().optional(),
  specTitulo: z.string().optional(),
  quantidade: tolerantNumber,
  precoAjuste: tolerantNumber,
  valorOperacao: tolerantNumber,
  tipoMercado: z.string().optional(),
  obs: z.string().nullish(),
});

export const bovTicketInfoSchema = z.looseObject({
  numeroNota: z.union([z.string(), z.number()]).optional(),
  dataPregao: z.string().optional(),
  dataLiqui: z.string().optional(),
  numeroCliente: z.union([z.string(), z.number()]).optional(),
  codCliente: z.union([z.string(), z.number()]).optional(),
  docCliente: z.string().optional(),
  bolsaDataEmol: tolerantNumber,
  bolsaDataEmolText: z.string().optional(),
  clearDataTaxaLiq: tolerantNumber,
  clearDataTaxaLiqText: z.string().optional(),
  clearDataTaxaReg: tolerantNumber,
  clearDataTaxaRegText: z.string().optional(),
  correDataTotal: tolerantNumber,
  correDataTotalText: z.string().optional(),
  correDataIss: tolerantNumber,
  correDataIssText: z.string().optional(),
  correDataIrrf: tolerantNumber,
  correDataIrrfText: z.string().optional(),
  correDataTTA: tolerantNumber,
  correDataTTAText: z.string().optional(),
  pis: tolerantNumber,
  cofins: tolerantNumber,
});

export const bovSummarizedTradeSchema = z.looseObject({
  specTitulo: z.string().optional(),
  quantidade: tolerantNumber,
  valorOperacao: tolerantNumber,
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
  iss: tolerantNumber,
  pis: tolerantNumber,
  cofins: tolerantNumber,
  cvm179_fee: tolerantNumber,
  total_fees: tolerantNumber,
  daytrade_adjustment: tolerantNumber,
  position_adjustment: tolerantNumber,
  total_net: tolerantNumber,
});

export const bmfNoteSchema = z.looseObject({
  financialSummary: bmfFinancialSummarySchema.optional(),
  ticketInfo: z
    .looseObject({
      numeroNota: z.union([z.string(), z.number()]).optional(),
      dataPregao: z.string().optional(),
      codCliente: z.union([z.string(), z.number()]).optional(),
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
    .looseObject({ account_number: z.union([z.string(), z.number()]).optional() })
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
export type BrokerageNotesResponse = z.infer<typeof brokerageNotesResponseSchema>;
