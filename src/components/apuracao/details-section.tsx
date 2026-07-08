"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConsolidatedResult } from "@/lib/apuracao/types";
import { formatBRL, formatBRLSigned, formatInt, plClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MERCADO_LABEL } from "./job-types";

export function DetailsSection({ result }: { result: ConsolidatedResult }) {
  const [open, setOpen] = useState(false);
  const hasAluguel =
    result.aluguel.remuneracao !== 0 ||
    result.aluguel.taxas !== 0 ||
    result.aluguel.irrf !== 0;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Posições em aberto, aluguel e alertas</CardTitle>
              <CardDescription>
                {formatInt(result.posicoesAbertas.length)} posição(ões) em
                aberto · {formatInt(result.alertas.length)} alerta(s)
              </CardDescription>
            </div>
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-medium">
                Posições em aberto ao fim do período
              </h3>
              {result.posicoesAbertas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma posição em aberto — tudo fechado no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Mercado</TableHead>
                        <TableHead>Lado</TableHead>
                        <TableHead>Quantidade</TableHead>
                        <TableHead>Preço médio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.posicoesAbertas.map((pos) => (
                        <TableRow key={`${pos.mercado}-${pos.ticker}`}>
                          <TableCell className="font-medium">
                            {pos.ticker}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {MERCADO_LABEL[pos.mercado] ?? pos.mercado}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {pos.side === "comprado" ? "Comprado" : "Vendido"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatInt(pos.quantidade)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatBRL(pos.precoMedio)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {hasAluguel && (
              <>
                <Separator />
                <section>
                  <h3 className="mb-2 text-sm font-medium">
                    Aluguel de ativos (BTC) — linha separada
                  </h3>
                  <dl className="grid gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Remuneração</dt>
                      <dd className="tabular-nums">
                        {formatBRL(result.aluguel.remuneracao)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Taxas</dt>
                      <dd className="tabular-nums">
                        {formatBRL(result.aluguel.taxas)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">IRRF</dt>
                      <dd className="tabular-nums">
                        {formatBRL(result.aluguel.irrf)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Líquido</dt>
                      <dd
                        className={cn(
                          "font-medium tabular-nums",
                          plClass(result.aluguel.liquido),
                        )}
                      >
                        {formatBRLSigned(result.aluguel.liquido)}
                      </dd>
                    </div>
                  </dl>
                </section>
              </>
            )}

            {result.alertas.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Alertas de validação</h3>
                  {result.alertas.map((alerta) => (
                    <Alert key={alerta} variant="destructive">
                      <AlertTriangle className="size-4" aria-hidden />
                      <AlertTitle>Divergência de validação cruzada</AlertTitle>
                      <AlertDescription>{alerta}</AlertDescription>
                    </Alert>
                  ))}
                </section>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
