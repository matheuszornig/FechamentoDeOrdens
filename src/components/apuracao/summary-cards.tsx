"use client";

import { Activity, Receipt, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { computeClosedTotals } from "@/lib/apuracao/closed-totals";
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
  // Mesma base da tabela "Resultado fechado por ticker" (só o que fechou no
  // período) — este card bate com o rodapé dessa tabela. Difere de
  // `totais.resultadoLiquido`, que soma o período inteiro (posições ainda
  // abertas + aluguel).
  const fechados = computeClosedTotals(result);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile
        icon={TrendingUp}
        label="Resultado líquido do período"
        value={formatBRLSigned(fechados.liquido)}
        valueClass={plClass(fechados.liquido)}
        hint={`Bruto: ${formatBRLSigned(fechados.bruto)}`}
      />
      <StatTile
        icon={Receipt}
        label="Custos totais"
        value={formatBRL(fechados.custos)}
        hint={`IRRF retido: ${formatBRL(fechados.irrf)}`}
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
