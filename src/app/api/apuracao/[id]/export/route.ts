import { and, eq, gte, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { dedupeNotes } from "@/lib/apuracao/engine";
import type { ConsolidatedResult } from "@/lib/apuracao/types";
import { requireSession } from "@/lib/auth";
import { mapNotesPayload } from "@/lib/btg/mapper";
import { buildAuditWorkbook } from "@/lib/export/xlsx-export";

type Params = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exporta as notas e o resultado de um job concluído em XLSX, para
 * teste/auditoria. Re-mapeia do payload bruto (fonte da verdade) para
 * garantir consistência com o número exibido na tela.
 */
export async function GET(request: Request, { params }: Params) {
  const session = await requireSession(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.apuracaoJob)
    .where(eq(schema.apuracaoJob.id, id));
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }
  if (job.status !== "concluido" || !job.result) {
    return NextResponse.json(
      { error: "Job ainda não foi concluído" },
      { status: 409 },
    );
  }

  const noteRows = await db
    .select()
    .from(schema.brokerageNote)
    .where(
      and(
        eq(schema.brokerageNote.accountNumber, job.accountNumber),
        gte(schema.brokerageNote.tradeDate, job.startDate),
        lte(schema.brokerageNote.tradeDate, job.endDate),
      ),
    );

  // `rawPayload` é a resposta do dia inteira, replicada em toda linha
  // extraída daquele dia — sem dedup, notas de dias com múltiplos negócios
  // apareceriam repetidas (uma vez por linha lida). dedupeNotes é a mesma
  // regra de idempotência (nº nota + conta + mercado) que o motor aplica.
  const notes = dedupeNotes(
    noteRows.flatMap((row) =>
      mapNotesPayload(row.rawPayload, job.accountNumber, row.tradeDate),
    ),
  );

  const workbookBytes = buildAuditWorkbook(
    job.accountNumber,
    job.startDate,
    job.endDate,
    notes,
    job.result as ConsolidatedResult,
  );

  const filename = `apuracao-${job.accountNumber}-${job.startDate}-a-${job.endDate}.xlsx`;
  // Uint8Array é um BodyInit válido em runtime; o cast contorna a variância
  // estrita de ArrayBufferLike vs ArrayBuffer nos tipos do lib.dom mais recente.
  return new NextResponse(workbookBytes as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
