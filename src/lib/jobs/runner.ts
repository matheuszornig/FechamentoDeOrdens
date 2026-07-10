import { and, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listBusinessDays } from "@/lib/apuracao/business-days";
import { apurar } from "@/lib/apuracao/engine";
import {
  mapNotesPayloadWithRaw,
  mapPositionPayload,
  trimPositionPayload,
} from "@/lib/btg/mapper";
import { getBtgService } from "@/lib/btg/service";
import type { InitialPosition } from "@/lib/btg/types";
import { loadPeriodNotes } from "./load-notes";

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
  includePosition = false,
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
        eq(schema.apuracaoJob.includePosition, includePosition),
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
      includePosition,
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
        errorMessage: formatError(err),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.apuracaoJob.id, job.id));
  }
}

/**
 * Drizzle envolve o erro real do driver em `.cause` (ex.: "Failed query: ..."
 * na mensagem, com o erro do Postgres/Neon só disponível em `.cause`) — sem
 * isso, o motivo de fato (ex.: "response is too large") fica invisível no
 * errorMessage persistido no job.
 */
/** D-1 em calendário: "2026-01-01" − 1 dia → "2025-12-31". */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause ? `${err.message} — causa: ${cause}` : err.message;
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
          // rawPayload guarda só o fragmento desta nota (não a resposta do
          // dia inteiro) — uma nota com muitos negócios não deve inflar o
          // armazenamento de todas as outras notas extraídas do mesmo dia.
          for (const { note, raw } of mapNotesPayloadWithRaw(
            result.raw,
            job.accountNumber,
            day,
          )) {
            await db
              .insert(schema.brokerageNote)
              .values({
                accountNumber: note.accountNumber,
                tradeDate: note.date,
                market: note.market,
                noteNumber: note.noteNumber,
                normalized: note,
                rawPayload: raw as object,
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
        const message = formatError(err);
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

  // Posição inicial (opcional): a posição da conta em D-1 do início do
  // período — quem começou 01/01 apura sobre a carteira de 31/12. Buscada
  // uma única vez e persistida no job (idempotente entre retomadas).
  let initialPositions: InitialPosition[] = [];
  if (job.includePosition) {
    let payload = job.positionPayload;
    if (!payload) {
      const positionDate = addDaysIso(job.startDate, -1);
      const fetched = await getBtgService().fetchPosition(
        job.accountNumber,
        positionDate,
      );
      payload =
        fetched.kind === "position"
          ? trimPositionPayload(fetched.raw)
          : { PositionDate: positionDate, Equities: [] };
      await db
        .update(schema.apuracaoJob)
        .set({ positionPayload: payload, updatedAt: new Date() })
        .where(eq(schema.apuracaoJob.id, job.id));
    }
    initialPositions = mapPositionPayload(payload);
  }

  // Notas re-mapeadas do payload bruto, carregadas em lotes limitados por
  // bytes — uma query única com o período inteiro estoura o teto de 64MB de
  // resposta do Neon em contas volumosas (loadPeriodNotes).
  const notes = await loadPeriodNotes(
    job.accountNumber,
    job.startDate,
    job.endDate,
  );
  const result = apurar(notes, { endDate: job.endDate, initialPositions });

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
