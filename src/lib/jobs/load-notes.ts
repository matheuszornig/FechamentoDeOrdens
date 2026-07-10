import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { dedupeNotes } from "@/lib/apuracao/engine";
import { mapNotesPayload } from "@/lib/btg/mapper";
import type { NormalizedNote } from "@/lib/btg/types";

/**
 * Orçamento de bytes de coluna por lote — bem abaixo do teto de 64MB por
 * resposta do driver HTTP do Neon (a serialização JSON da resposta adiciona
 * overhead sobre os bytes brutos das colunas). Uma única linha maior que o
 * orçamento vira um lote sozinha (maior nota real observada: ~25MB).
 */
const BATCH_BYTES = 24_000_000;

/**
 * Carrega as notas de (conta, período) re-mapeadas do payload bruto, em
 * lotes limitados por bytes. Uma única query com todas as colunas estoura o
 * teto de resposta do Neon em contas volumosas (visto em produção: ~59MB de
 * raw+normalized para 10 meses) — então primeiro lê só id+tamanho, agrupa em
 * lotes e busca cada lote apenas com trade_date + raw_payload (o normalized
 * não é usado: o mapper re-mapeia do bruto, valendo retroativamente).
 * Dedup pela regra do motor (nº nota + conta + mercado).
 */
export async function loadPeriodNotes(
  accountNumber: string,
  startDate: string,
  endDate: string,
): Promise<NormalizedNote[]> {
  const db = getDb();

  const meta = await db
    .select({
      id: schema.brokerageNote.id,
      size: sql<number>`length(${schema.brokerageNote.rawPayload}::text)`,
    })
    .from(schema.brokerageNote)
    .where(
      and(
        eq(schema.brokerageNote.accountNumber, accountNumber),
        gte(schema.brokerageNote.tradeDate, startDate),
        lte(schema.brokerageNote.tradeDate, endDate),
      ),
    )
    .orderBy(asc(schema.brokerageNote.tradeDate), asc(schema.brokerageNote.id));

  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const row of meta) {
    if (current.length > 0 && currentBytes + Number(row.size) > BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(row.id);
    currentBytes += Number(row.size);
  }
  if (current.length > 0) batches.push(current);

  const notes: NormalizedNote[] = [];
  for (const ids of batches) {
    const rows = await db
      .select({
        tradeDate: schema.brokerageNote.tradeDate,
        rawPayload: schema.brokerageNote.rawPayload,
      })
      .from(schema.brokerageNote)
      .where(inArray(schema.brokerageNote.id, ids));
    for (const row of rows) {
      notes.push(
        ...mapNotesPayload(row.rawPayload, accountNumber, row.tradeDate),
      );
    }
  }
  return dedupeNotes(notes);
}
