"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, Play } from "lucide-react";
import { ptBR } from "react-day-picker/locale";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type ApuracaoFilter,
  apuracaoFilterSchema,
  maxEndDateIso,
} from "@/lib/apuracao/validation";
import { formatDateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

function toLocalDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function DatePickerField({
  id,
  label,
  value,
  onChange,
  error,
  maxIso,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (iso: string) => void;
  error?: string;
  maxIso: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className={cn(
                "w-full justify-start font-normal",
                !value && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 size-4" aria-hidden />
              {value ? formatDateBR(value) : "Selecione a data"}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            captionLayout="dropdown"
            selected={value ? toLocalDate(value) : undefined}
            defaultMonth={value ? toLocalDate(value) : toLocalDate(maxIso)}
            disabled={{ after: toLocalDate(maxIso) }}
            onSelect={(date) => {
              if (date) onChange(toIso(date));
            }}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function FilterCard({
  onSubmit,
  disabled,
}: {
  onSubmit: (filter: ApuracaoFilter) => void;
  disabled: boolean;
}) {
  const maxIso = maxEndDateIso();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ApuracaoFilter>({
    resolver: zodResolver(apuracaoFilterSchema),
    defaultValues: { conta: "", dataInicio: "", dataFim: "" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apuração de resultados</CardTitle>
        <CardDescription>
          Informe a conta e o período (até 12 meses, com fim até ontem — a API
          do BTG não publica o dia corrente).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="conta">Nº da conta</Label>
            <Input
              id="conta"
              inputMode="numeric"
              placeholder="000000000"
              {...register("conta")}
            />
            {errors.conta && (
              <p className="text-sm text-destructive">{errors.conta.message}</p>
            )}
          </div>
          <Controller
            control={control}
            name="dataInicio"
            render={({ field }) => (
              <DatePickerField
                id="dataInicio"
                label="Data início"
                value={field.value}
                onChange={field.onChange}
                error={errors.dataInicio?.message}
                maxIso={maxIso}
              />
            )}
          />
          <Controller
            control={control}
            name="dataFim"
            render={({ field }) => (
              <DatePickerField
                id="dataFim"
                label="Data fim"
                value={field.value}
                onChange={field.onChange}
                error={errors.dataFim?.message}
                maxIso={maxIso}
              />
            )}
          />
          <Button type="submit" disabled={disabled} className="sm:mb-[1px]">
            <Play className="mr-1 size-4" aria-hidden />
            Apurar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
