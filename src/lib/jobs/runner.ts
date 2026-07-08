import { and, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listBusinessDays } from "@/lib/apuracao/business-days";
import { apurar } from "@/lib/apuracao/engine";
import { mapNotesPayload } from "@/lib/btg/mapper";
import { getBtgService } from "@/lib/btg/service";

const ACTIVE_STATUSES = ["pendente", "buscando", "calculando"] as const;

/**
 * Orçamento de tempo de uma fatia de processamento. As rotas rodam com
 * maxDuration=300s; paramos antes para atualizar o estado com folga — o
 * próximo polling detecta o job incompleto (lock vencido) e retoma de onde
 * parou. O estado no banco é a fonte da verdade.
 */
const SLICE_BUDGET_MS = Number(process.env.JOB_SLICE_BUDGET_MS ?? 250_000);

/** Lock/heartbeat: renovado a cada data; vencido há mais que isso → retomável. */
export const LOCK_TTL_MS = 30_000;

export type ApuracaoJobRow = typeof schema.apuracaoJob.$inferSelect;

export function isJobActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isLockStale(job: ApuracaoJobRow, now = Date.now()): boolean {
  return !job.lockedAt || now - job.lockedAt.getTime() > LOCK_TTL_MS;
}

/**
 * Cria um job para (conta, período) ou devolve o job ativo existente —
 * é o rate limit próprio do endpoint: nunca há dois jobs simultâneos da
 * mesma conta+período.
 */
export async function createOrReuseJob(
  accountNumber: string,
  startDate: string,
  endDate: string,
): Promise<{ job: ApuracaoJobRow; reused: boolean }> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.apuracaoJob)
    .where(
      and(
        eq(schema.apuracaoJob.accountNumber, accountNumber),
        eq(schema.apuracaoJob.startDate, startDate),
        eq(schema.apuracaoJob.endDate, endDate),
        inArray(schema.apuracaoJob.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  if (existing) {
    return { job: existing, reused: true };
  }

  const totalDates = listBusinessDays(startDate, endDate).length;
  const [job] = await db
    .insert(schema.apuracaoJob)
    .values({
      accountNumber,
      startDate,
      endDate,
      status: "pendente",
      totalDates,
    })
    .returning();
  return { job, reused: false };
}

/**
 * Processa uma fatia do job. Idempotente e concorrência-segura: o lock é
 * adquirido com UPDATE condicional; se outra invocação estiver ativa
 * (heartbeat recente), retorna sem fazer nada.
 */
export async function processJobSlice(jobId: string): Promise<void> {
  const db = getDb();
  const [job] = await db
    .update(schema.apuracaoJob)
    .set({ lockedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.apuracaoJob.id, jobId),
        inArray(schema.apuracaoJob.status, [...ACTIVE_STATUSES]),
        or(
          isNull(schema.apuracaoJob.lockedAt),
          lt(schema.apuracaoJob.lockedAt, new Date(Date.now() - LOCK_TTL_MS)),
        ),
      ),
    )
    .returning();
  if (!job) return;

  try {
    await runSlice(job);
  } catch (err) {
    await db
      .update(schema.apuracaoJob)
      .set({
        status: "erro",
        errorMessage: err instanceof Error ? err.message : String(err),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.apuracaoJob.id, job.id));
  }
}

async function runSlice(job: ApuracaoJobRow): Promise<void> {
  const db = getDb();
  const startedAt = Date.now();
  const days = listBusinessDays(job.startDate, job.endDate);

  // Datas já resolvidas no cache (com notas ou vazias); "erro" volta à fila.
  const fetched = await db
    .select()
    .from(schema.fetchedDate)
    .where(
      and(
        eq(schema.fetchedDate.accountNumber, job.accountNumber),
        gte(schema.fetchedDate.tradeDate, job.startDate),
        lte(schema.fetchedDate.tradeDate, job.endDate),
      ),
    );
  const resolved = new Set(
    fetched.filter((f) => f.outcome !== "erro").map((f) => f.tradeDate),
  );

  const pendingDays = days.filter((d) => !resolved.has(d));
  let processed = days.length - pendingDays.length;

  const heartbeat = (status: "buscando" | "calculando") =>
    db
      .update(schema.apuracaoJob)
      .set({
        status,
        processedDates: processed,
        totalDates: days.length,
        lockedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.apuracaoJob.id, job.id));

  if (pendingDays.length > 0) {
    await heartbeat("buscando");
    const service = getBtgService();

    for (const day of pendingDays) {
      // Fatia esgotada: o próximo polling retoma do ponto atual.
      if (Date.now() - startedAt > SLICE_BUDGET_MS) {
        await db
          .update(schema.apuracaoJob)
          .set({ lockedAt: null, updatedAt: new Date() })
          .where(eq(schema.apuracaoJob.id, job.id));
        return;
      }

      // Cancelamento pelo usuário é observado entre datas.
      const [current] = await db
        .select({ status: schema.apuracaoJob.status })
        .from(schema.apuracaoJob)
        .where(eq(schema.apuracaoJob.id, job.id));
      if (!current || current.status === "cancelado") return;

      try {
        const result = await service.fetchNotes(job.accountNumber, day);
        if (result.kind === "notes") {
          for (const note of result.notes) {
            await db
              .insert(schema.brokerageNote)
              .values({
                accountNumber: note.accountNumber,
                tradeDate: note.date,
                market: note.market,
                noteNumber: note.noteNumber,
                normalized: note,
                rawPayload: result.raw as object,
              })
              .onConflictDoNothing();
          }
        }
        await db
          .insert(schema.fetchedDate)
          .values({
            accountNumber: job.accountNumber,
            tradeDate: day,
            outcome: result.kind === "notes" ? "com_notas" : "sem_notas",
          })
          .onConflictDoUpdate({
            target: [
              schema.fetchedDate.accountNumber,
              schema.fetchedDate.tradeDate,
            ],
            set: {
              outcome: result.kind === "notes" ? "com_notas" : "sem_notas",
              errorMessage: null,
              fetchedAt: new Date(),
            },
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .insert(schema.fetchedDate)
          .values({
            accountNumber: job.accountNumber,
            tradeDate: day,
            outcome: "erro",
            errorMessage: message,
          })
          .onConflictDoUpdate({
            target: [
              schema.fetchedDate.accountNumber,
              schema.fetchedDate.tradeDate,
            ],
            set: {
              outcome: "erro",
              errorMessage: message,
              fetchedAt: new Date(),
            },
          });
        throw new Error(`Falha ao buscar notas de ${day}: ${message}`);
      }

      processed += 1;
      await heartbeat("buscando");
    }
  }

  // Todas as datas resolvidas → apuração.
  await heartbeat("calculando");
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

  // Re-mapeia do payload bruto: o rawPayload é a fonte da verdade e assim
  // melhorias do mapper valem retroativamente para notas já cacheadas (o
  // motor dedup-lica por nº nota + conta + mercado, então payloads completos
  // repetidos entre linhas do mesmo dia não duplicam nada).
  const result = apurar(
    noteRows.flatMap((row) =>
      mapNotesPayload(row.rawPayload, job.accountNumber, row.tradeDate),
    ),
    { endDate: job.endDate },
  );

  await db
    .update(schema.apuracaoJob)
    .set({
      status: "concluido",
      processedDates: days.length,
      totalDates: days.length,
      result,
      alerts: result.alertas,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.apuracaoJob.id, job.id));
}
