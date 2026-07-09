"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DailyPoint } from "@/lib/apuracao/types";
import {
  formatBRL,
  formatBRLSigned,
  formatDateBR,
  formatDateShort,
} from "@/lib/format";

/**
 * Paletas validadas com o validador do design system (6 checks, light/dark):
 * verde/vermelho = polaridade do resultado diário (reforçada pela posição da
 * barra acima/abaixo do zero), azul = linha do acumulado.
 */
const PALETTE = {
  light: { pos: "#059669", neg: "#dc2626", line: "#2563eb" },
  dark: { pos: "#059669", neg: "#ef4444", line: "#3b82f6" },
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

const compactBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Ponto plotado: só o realizado por ticker (sem futuros nem aluguel). */
interface ChartPoint {
  date: string;
  resultado: number;
  acumulado: number;
}

interface TooltipPayloadEntry {
  payload?: ChartPoint;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const rows: Array<[string, number]> = [
    ["Resultado do dia", point.resultado],
    ["Acumulado", point.acumulado],
  ];
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{formatDateBR(point.date)}</p>
      <dl className="space-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-6">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{formatBRLSigned(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PlChart({ data }: { data: DailyPoint[] }) {
  const { resolvedTheme } = useTheme();
  const colors = PALETTE[resolvedTheme === "dark" ? "dark" : "light"];

  // Mesma base da tabela "Resultado fechado por ticker": só o realizado do
  // dia, sem futuros (tabela própria) nem aluguel — acumulado recalculado
  // sobre essa base.
  const points = useMemo(() => {
    let acumulado = 0;
    return data.map<ChartPoint>((d) => {
      acumulado = round2(acumulado + d.resultado);
      return { date: d.date, resultado: d.resultado, acumulado };
    });
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolução do P/L</CardTitle>
        <CardDescription>
          Resultado realizado por dia de pregão (barras) e acumulado no período
          (linha) — sem futuros e aluguel, mesma base do resultado por ticker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="h-80 w-full"
          role="img"
          aria-label="Gráfico de evolução do P/L diário e acumulado"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => compactBRL.format(v)}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                width={90}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fillOpacity: 0.06 }}
              />
              <Legend
                formatter={(value: string) =>
                  value === "resultado" ? "Resultado diário" : "Acumulado"
                }
              />
              <ReferenceLine y={0} strokeOpacity={0.3} />
              <Bar
                dataKey="resultado"
                name="resultado"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              >
                {points.map((point) => (
                  <Cell
                    key={point.date}
                    fill={point.resultado >= 0 ? colors.pos : colors.neg}
                  />
                ))}
              </Bar>
              <Line
                dataKey="acumulado"
                name="acumulado"
                stroke={colors.line}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Total acumulado no período:{" "}
          <span className="tabular-nums">
            {formatBRL(points.at(-1)?.acumulado ?? 0)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
