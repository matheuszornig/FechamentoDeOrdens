"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApuracaoFilter } from "@/lib/apuracao/validation";
import { signOut } from "@/lib/auth-client";
import { CostsTable } from "./costs-table";
import { FilterCard } from "./filter-card";
import { FuturesTable } from "./futures-table";
import { isActiveStatus, type JobResponse } from "./job-types";
import { PlChart } from "./pl-chart";
import { ProgressCard } from "./progress-card";
import { ResultTable } from "./result-table";
import { SummaryCards } from "./summary-cards";

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Erro ${res.status}`);
  }
  return body;
}

export function ApuracaoScreen({
  userEmail,
  isAdmin,
}: {
  userEmail: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const notifiedRef = useRef<string | null>(null);

  const createJob = useMutation({
    mutationFn: async (filter: ApuracaoFilter) => {
      const res = await fetch("/api/apuracao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      return jsonOrThrow(res) as Promise<{ jobId: string; reused: boolean }>;
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      notifiedRef.current = null;
      queryClient.removeQueries({ queryKey: ["apuracao-job"] });
      if (data.reused) {
        toast.info("Já existe uma apuração ativa para esta conta e período", {
          description: "Acompanhando o job existente.",
        });
      }
    },
    onError: (err) => {
      toast.error("Não foi possível iniciar a apuração", {
        description: err.message,
      });
    },
  });

  const jobQuery = useQuery<JobResponse>({
    queryKey: ["apuracao-job", jobId],
    enabled: jobId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/apuracao/${jobId}`);
      return jsonOrThrow(res) as Promise<JobResponse>;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isActiveStatus(status) ? false : 2000;
    },
  });

  const cancelJob = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/apuracao/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      return jsonOrThrow(res);
    },
    onSuccess: () => {
      toast.info("Apuração cancelada");
      jobQuery.refetch();
    },
    onError: (err) => {
      toast.error("Não foi possível cancelar", { description: err.message });
    },
  });

  const exportXlsx = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/apuracao/${jobId}/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erro ${res.status}`);
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? "apuracao.xlsx";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => {
      toast.error("Não foi possível exportar", { description: err.message });
    },
  });

  const job = jobQuery.data;

  // Toasts de desfecho (uma vez por job).
  useEffect(() => {
    if (!job || notifiedRef.current === `${job.id}:${job.status}`) return;
    if (job.status === "concluido") {
      notifiedRef.current = `${job.id}:${job.status}`;
      toast.success("Apuração concluída");
    } else if (job.status === "erro") {
      notifiedRef.current = `${job.id}:${job.status}`;
      toast.error("A apuração falhou", {
        description: job.errorMessage ?? "Erro desconhecido",
      });
    }
  }, [job]);

  const isRunning =
    createJob.isPending || (job !== undefined && isActiveStatus(job.status));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Fechamento de Ordens</h1>
          <p className="text-sm text-muted-foreground">
            Apuração de renda variável via notas de corretagem do BTG Pactual
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {userEmail}
          </span>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Usuários"
              render={<Link href="/usuarios" />}
            >
              <Users className="size-4" aria-hidden />
            </Button>
          )}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sair"
            onClick={async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <FilterCard
        onSubmit={(filter) => createJob.mutate(filter)}
        disabled={isRunning}
      />

      {job && isActiveStatus(job.status) && (
        <ProgressCard
          job={job}
          onCancel={() => cancelJob.mutate()}
          canceling={cancelJob.isPending}
        />
      )}

      {job && isActiveStatus(job.status) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["a", "b", "c", "d"].map((key) => (
            <Card key={key}>
              <CardContent className="space-y-3 pt-6">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-8 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {job?.status === "concluido" && job.result && (
        <>
          {job.mock && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
              <strong>Dados simulados:</strong> o servidor está com{" "}
              <code>BTG_USE_MOCK=true</code> — estas notas são fictícias e
              determinísticas, não vieram da API do BTG.
            </div>
          )}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportXlsx.mutate()}
              disabled={exportXlsx.isPending}
            >
              <Download className="mr-1 size-4" aria-hidden />
              {exportXlsx.isPending ? "Exportando…" : "Exportar Excel"}
            </Button>
          </div>
          <SummaryCards result={job.result} />
          <PlChart data={job.result.serieDiaria} />
          <ResultTable result={job.result} />
          <FuturesTable result={job.result} />
          <CostsTable result={job.result} />
        </>
      )}

      {!job && !createJob.isPending && (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Preencha o filtro acima e clique em <strong>Apurar</strong> para
            buscar as notas do período e calcular o resultado por ticker.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
