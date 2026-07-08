"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ConsolidatedResult,
  CostBreakdown,
  TickerCosts,
} from "@/lib/apuracao/types";
import { formatBRL } from "@/lib/format";

const COST_COLUMNS: Array<{
  key: keyof CostBreakdown & string;
  label: string;
}> = [
  { key: "corretagem", label: "Corretagem" },
  { key: "emolumentos", label: "Emolumentos" },
  { key: "liquidacao", label: "Liquidação" },
  { key: "registro", label: "Registro" },
  { key: "iss", label: "ISS" },
  { key: "pis", label: "PIS" },
  { key: "cofins", label: "COFINS" },
  { key: "outros", label: "Outros" },
  { key: "irrf", label: "IRRF" },
  { key: "total", label: "Total" },
];

export function CostsTable({ result }: { result: ConsolidatedResult }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "total", desc: true },
  ]);

  const columns = useMemo<ColumnDef<TickerCosts>[]>(
    () => [
      {
        accessorKey: "ticker",
        header: "Ticker",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.ticker}</span>
        ),
      },
      ...COST_COLUMNS.map<ColumnDef<TickerCosts>>(({ key, label }) => ({
        accessorKey: key,
        header: label,
        cell: ({ row }) => (
          <span className="tabular-nums">{formatBRL(row.original[key])}</span>
        ),
      })),
    ],
    [],
  );

  const table = useReactTable({
    data: result.custosPorTicker,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custos por ticker</CardTitle>
        <CardDescription>
          Detalhamento por tipo de custo, rateado proporcionalmente ao valor
          financeiro de cada negócio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result.custosPorTicker.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum custo registrado no período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  {COST_COLUMNS.map(({ key }) => (
                    <TableCell key={key} className="tabular-nums">
                      {formatBRL(result.custosTotais[key])}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
