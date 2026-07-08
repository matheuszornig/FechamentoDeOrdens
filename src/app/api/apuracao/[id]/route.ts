import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { isJobActive, isLockStale, processJobSlice } from "@/lib/jobs/runner";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Status do job para o polling do frontend. Se o job está ativo mas sem
 * processamento em andamento (lock vencido — a invocação anterior estourou o
 * orçamento de tempo ou morreu), dispara a continuação de onde parou.
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

  if (isJobActive(job.status) && isLockStale(job)) {
    after(() => processJobSlice(job.id));
  }

  return NextResponse.json({
    id: job.id,
    conta: job.accountNumber,
    dataInicio: job.startDate,
    dataFim: job.endDate,
    status: job.status,
    totalDates: job.totalDates,
    processedDates: job.processedDates,
    errorMessage: job.errorMessage,
    result: job.result,
    alerts: job.alerts,
    updatedAt: job.updatedAt,
  });
}

/** Cancela um job ativo ({"action": "cancel"}). */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!UUID_RE.test(id) || body?.action !== "cancel") {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.apuracaoJob)
    .where(eq(schema.apuracaoJob.id, id));
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }
  if (!isJobActive(job.status)) {
    return NextResponse.json({ error: "Job não está ativo" }, { status: 409 });
  }

  await db
    .update(schema.apuracaoJob)
    .set({
      status: "cancelado",
      errorMessage: "Cancelado pelo usuário",
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.apuracaoJob.id, id));

  return NextResponse.json({ ok: true });
}
