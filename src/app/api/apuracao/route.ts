import { after, NextResponse } from "next/server";
import { apuracaoFilterSchema } from "@/lib/apuracao/validation";
import { requireSession } from "@/lib/auth";
import { createOrReuseJob, processJobSlice } from "@/lib/jobs/runner";

// Máximo do plano na Vercel (fluid compute); o slice para antes (ver runner).
export const maxDuration = 300;

/**
 * Cria (ou reaproveita) o job de apuração para conta+período e dispara o
 * processamento em background via `after()` — a resposta volta imediatamente
 * e o frontend acompanha por polling em GET /api/apuracao/[id].
 */
export async function POST(request: Request) {
  const session = await requireSession(request.headers);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = apuracaoFilterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Filtro inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { conta, dataInicio, dataFim } = parsed.data;
  const { job, reused } = await createOrReuseJob(conta, dataInicio, dataFim);

  if (!reused) {
    after(() => processJobSlice(job.id));
  }

  return NextResponse.json(
    { jobId: job.id, reused },
    { status: reused ? 200 : 201 },
  );
}
