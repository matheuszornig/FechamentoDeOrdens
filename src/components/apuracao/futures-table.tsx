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

export function FuturesTable({ result }: { result: ConsolidatedResult }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "ajustesFuturos", desc: true },
  ]);

  // Mercadorias BM&F com atividade no período — negócios executados ou
  // ajustes diários lançados (posição carregada gera ajuste sem negócio).
  const rows = useMemo(
    () =>
      result.porTicker.filter(
        (t) =>
          t.mercado === "bmf" && (t.operacoes > 0 || t.ajustesFuturos !== 0),
      ),
    [result.porTicker],
  );

  const totais = useMemo(
    () =>
      rows.reduce(
        (acc, t) => ({
          ajustes: acc.ajustes + t.ajustesFuturos,
          custos: acc.custos + t.custos,
          liquido: acc.liquido + t.resultadoLiquido,
        }),
        { ajustes: 0, custos: 0, liquido: 0 },
      ),
    [rows],
  );

  const columns = useMemo<ColumnDef<TickerResult>[]>(
    () => [
      {
        accessorKey: "ticker",
        header: ({ column }) => (
          <SortableHeader label="Mercadoria" column={column} />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.ticker}</span>
        ),
      },
      {
        accessorKey: "quantidade",
        header: ({ column }) => (
          <SortableHeader label="Quantidade" column={column} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInt(row.original.quantidade)}
          </span>
        ),
      },
      {
        accessorKey: "ajustesFuturos",
        header: ({ column }) => (
          <SortableHeader label="Ajustes do período" column={column} />
        ),
        cell: ({ row }) => (
          <span
            className={cn("tabular-nums", plClass(row.original.ajustesFuturos))}
          >
            {formatBRLSigned(row.original.ajustesFuturos)}
          </span>
        ),
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
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Sem futuros no período não há o que mostrar — o card inteiro some para
  // não poluir contas que só operam bolsa/opções.
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operações com futuros</CardTitle>
        <CardDescription>
          Mercadorias BM&F do período — somatório dos ajustes (AJUPOS e
          liquidação diária dos negócios), custos rateados e resultado líquido.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                <TableCell />
                <TableCell
                  className={cn("tabular-nums", plClass(totais.ajustes))}
                >
                  {formatBRLSigned(totais.ajustes)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatBRL(totais.custos)}
                </TableCell>
                <TableCell
                  className={cn(
                    "font-medium tabular-nums",
                    plClass(totais.liquido),
                  )}
                >
                  {formatBRLSigned(totais.liquido)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
