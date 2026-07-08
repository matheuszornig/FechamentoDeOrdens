"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
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
import { DetailsSection } from "./details-section";
import { FilterCard } from "./filter-card";
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

export function ApuracaoScreen({ userEmail }: { userEmail: string }) {
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
          <SummaryCards result={job.result} />
          <PlChart data={job.result.serieDiaria} />
          <ResultTable result={job.result} />
          <CostsTable result={job.result} />
          <DetailsSection result={job.result} />
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
