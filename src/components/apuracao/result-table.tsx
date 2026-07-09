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
import { isFechado } from "@/lib/apuracao/closed-totals";
import type { ConsolidatedResult, TickerResult } from "@/lib/apuracao/types";
import { formatBRL, formatBRLSigned, formatInt, plClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MERCADO_LABEL } from "./job-types";

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

  // Só operações com algo de fato fechado no período — posições apenas
  // abertas (nada casado/exercido/vencido) não entram nesta tabela. Futuros
  // ficam de fora: têm tabela própria (Operações com futuros).
  const rows = useMemo(
    () => result.porTicker.filter((t) => isFechado(t) && t.mercado !== "bmf"),
    [result.porTicker],
  );

  // Rodapé soma só as linhas exibidas — o card "Resultado líquido do período"
  // (computeClosedTotals) equivale a este rodapé + o da tabela de futuros.
  const totais = useMemo(
    () =>
      rows.reduce(
        (acc, t) => ({
          bruto: acc.bruto + t.resultadoBruto + t.ajustesFuturos,
          custos: acc.custos + t.custos,
          liquido: acc.liquido + t.resultadoLiquido,
        }),
        { bruto: 0, custos: 0, liquido: 0 },
      ),
    [rows],
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
        accessorKey: "quantidadeFechada",
        header: ({ column }) => (
          <SortableHeader label="Quantidade Fechada" column={column} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInt(row.original.quantidadeFechada)}
          </span>
        ),
      },
      {
        accessorKey: "precoMedioCompra",
        header: "PM compra",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.precoMedioCompra !== null
              ? formatBRL(row.original.precoMedioCompra)
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "precoMedioVenda",
        header: "PM venda",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.precoMedioVenda !== null
              ? formatBRL(row.original.precoMedioVenda)
              : "—"}
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
        id: "custosSobreLucro",
        accessorFn: (row) => {
          const bruto = row.resultadoBruto + row.ajustesFuturos;
          return bruto !== 0 ? row.custos / Math.abs(bruto) : null;
        },
        header: ({ column }) => (
          <SortableHeader label="Custos/Lucro" column={column} />
        ),
        cell: ({ getValue }) => {
          const ratio = getValue<number | null>();
          return (
            <span className="tabular-nums">
              {ratio !== null ? `${(ratio * 100).toFixed(1)}%` : "—"}
            </span>
          );
        },
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resultado fechado por ticker</CardTitle>
        <CardDescription>
          Operações encerradas no período (exceto futuros, na tabela própria) —
          líquido desconta os custos rateados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma operação fechada no período.
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
                  <TableCell colSpan={5}>Total</TableCell>
                  <TableCell
                    className={cn("tabular-nums", plClass(totais.bruto))}
                  >
                    {formatBRLSigned(totais.bruto)}
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
                  <TableCell className="tabular-nums">
                    {totais.bruto !== 0
                      ? `${((totais.custos / Math.abs(totais.bruto)) * 100).toFixed(1)}%`
                      : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
