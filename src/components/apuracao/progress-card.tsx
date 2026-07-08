"use client";

import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { JobResponse } from "./job-types";

export function ProgressCard({
  job,
  onCancel,
  canceling,
}: {
  job: JobResponse;
  onCancel: () => void;
  canceling: boolean;
}) {
  const percent =
    job.status === "calculando"
      ? 100
      : job.totalDates > 0
        ? Math.round((job.processedDates / job.totalDates) * 100)
        : 0;

  const label =
    job.status === "pendente"
      ? "Preparando apuração…"
      : job.status === "buscando"
        ? `Buscando notas: ${job.processedDates}/${job.totalDates} dias…`
        : "Calculando resultados…";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
        <Loader2
          className="size-5 shrink-0 animate-spin text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{label}</span>
            <span className="tabular-nums text-muted-foreground">
              {percent}%
            </span>
          </div>
          <Progress value={percent} aria-label={label} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={canceling}
          className="shrink-0"
        >
          <XCircle className="mr-1 size-4" aria-hidden />
          Cancelar
        </Button>
      </CardContent>
    </Card>
  );
}
