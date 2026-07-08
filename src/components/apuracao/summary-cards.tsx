"use client";

import { Activity, Receipt, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ConsolidatedResult } from "@/lib/apuracao/types";
import { formatBRL, formatBRLSigned, formatInt, plClass } from "@/lib/format";
import { cn } from "@/lib/utils";

function StatTile({
  icon: Icon,
  label,
  value,
  valueClass,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          {label}
        </div>
        <p
          className={cn("mt-2 text-2xl font-semibold tabular-nums", valueClass)}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ result }: { result: ConsolidatedResult }) {
  const { totais } = result;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile
        icon={TrendingUp}
        label="Resultado líquido do período"
        value={formatBRLSigned(totais.resultadoLiquido)}
        valueClass={plClass(totais.resultadoLiquido)}
        hint={`Bruto: ${formatBRLSigned(totais.resultadoBruto)}`}
      />
      <StatTile
        icon={Receipt}
        label="Custos totais"
        value={formatBRL(totais.custos)}
        hint={`IRRF retido: ${formatBRL(totais.irrf)}`}
      />
      <StatTile
        icon={Activity}
        label="Operações"
        value={formatInt(totais.operacoes)}
        hint={`${formatInt(totais.operacoesFechadas)} fechadas no período`}
      />
    </div>
  );
}
