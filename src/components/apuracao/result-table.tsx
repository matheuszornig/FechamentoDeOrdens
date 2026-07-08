"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { ConsolidatedResult, TickerResult } from "@/lib/apuracao/types";
import { formatBRL, formatBRLSigned, formatInt, plClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MERCADO_LABEL, MODALIDADE_LABEL } from "./job-types";

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
}) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-8"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      <Icon className="ml-1 size-3.5" aria-hidden />
    </Button>
  );
}

export function ResultTable({ result }: { result: ConsolidatedResult }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "resultadoLiquido", desc: true },
  ]);

  const totalLiquido = useMemo(
    () => result.porTicker.reduce((acc, t) => acc + t.resultadoLiquido, 0),
    [result.porTicker],
  );

  const columns = useMemo<ColumnDef<TickerResult>[]>(
    () => [
      {
        accessorKey: "ticker",
        header: ({ column }) => (
          <SortableHeader label="Ticker" column={column} />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.ticker}</span>
        ),
      },
      {
        accessorKey: "mercado",
        header: "Mercado",
        cell: ({ row }) => (
          <Badge variant="secondary">
            {MERCADO_LABEL[row.original.mercado] ?? row.original.mercado}
          </Badge>
        ),
      },
      {
        accessorKey: "modalidade",
        header: "Modalidade",
        cell: ({ row }) =>
          MODALIDADE_LABEL[row.original.modalidade] ?? row.original.modalidade,
      },
      {
        accessorKey: "operacoes",
        header: ({ column }) => (
          <SortableHeader label="Operações" column={column} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInt(row.original.operacoes)}
          </span>
        ),
      },
      {
        accessorKey: "resultadoBruto",
        header: ({ column }) => (
          <SortableHeader label="Bruto" column={column} />
        ),
        cell: ({ row }) => {
          const bruto =
            row.original.resultadoBruto + row.original.ajustesFuturos;
          return (
            <span className={cn("tabular-nums", plClass(bruto))}>
              {formatBRLSigned(bruto)}
            </span>
          );
        },
      },
      {
        accessorKey: "custos",
        header: ({ column }) => (
          <SortableHeader label="Custos" column={column} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatBRL(row.original.custos)}</span>
        ),
      },
      {
        accessorKey: "resultadoLiquido",
        header: ({ column }) => (
          <SortableHeader label="Líquido" column={column} />
        ),
        cell: ({ row }) => (
          <span
            className={cn(
              "font-medium tabular-nums",
              plClass(row.original.resultadoLiquido),
            )}
          >
            {formatBRLSigned(row.original.resultadoLiquido)}
          </span>
        ),
      },
      {
        id: "percentual",
        header: "% do total",
        cell: ({ row }) => {
          const pct =
            totalLiquido !== 0
              ? (row.original.resultadoLiquido / totalLiquido) * 100
              : 0;
          return <span className="tabular-nums">{pct.toFixed(1)}%</span>;
        },
      },
    ],
    [totalLiquido],
  );

  const table = useReactTable({
    data: result.porTicker,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resultado fechado por ticker</CardTitle>
        <CardDescription>
          Operações encerradas no período — bruto inclui ajustes diários de
          futuros; líquido desconta os custos rateados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result.porTicker.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma operação encontrada no período.
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
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell
                    className={cn(
                      "tabular-nums",
                      plClass(result.totais.resultadoBruto),
                    )}
                  >
                    {formatBRLSigned(result.totais.resultadoBruto)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBRL(result.totais.custos)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-medium tabular-nums",
                      plClass(totalLiquido),
                    )}
                  >
                    {formatBRLSigned(totalLiquido)}
                  </TableCell>
                  <TableCell className="tabular-nums">100%</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
