import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import type { ConsolidatedResult } from "@/lib/apuracao/types";
import { requireSession } from "@/lib/auth";
import { buildAuditWorkbook } from "@/lib/export/xlsx-export";
import { loadPeriodNotes } from "@/lib/jobs/load-notes";

// Contas volumosas: carregar notas + gerar o workbook leva alguns segundos.
export const maxDuration = 300;

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

  // Notas re-mapeadas do bruto em lotes limitados por bytes (mesma carga da
  // apuração — teto de 64MB de resposta do Neon), já deduplicadas pela regra
  // do motor (nº nota + conta + mercado).
  const notes = await loadPeriodNotes(
    job.accountNumber,
    job.startDate,
    job.endDate,
  );

  const workbookBytes = buildAuditWorkbook(
    job.accountNumber,
    job.startDate,
    job.endDate,
    notes,
    job.result as ConsolidatedResult,
  );

  const filename = `apuracao-${job.accountNumber}-${job.startDate}-a-${job.endDate}.xlsx`;
  // Resposta em STREAMING: resposta bufferizada na Vercel é limitada a
  // ~4,5MB e derruba a função com 500 — o workbook de uma conta volumosa
  // passa disso mesmo comprimido (caso real: 16,7MB). Em chunks, sem
  // Content-Length, a função streama sem esse teto.
  const CHUNK = 1 << 20;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < workbookBytes.length; i += CHUNK) {
        controller.enqueue(workbookBytes.slice(i, i + CHUNK));
      }
      controller.close();
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
