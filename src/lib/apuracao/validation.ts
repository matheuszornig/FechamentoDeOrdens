import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de hoje no fuso de São Paulo (pregão da B3), em ISO. */
export function todaySaoPauloIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** D-1: a API do BTG não publica o dia corrente. */
export function maxEndDateIso(): string {
  const today = new Date(`${todaySaoPauloIso()}T00:00:00Z`);
  return new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Filtro da apuração — usado no formulário (React Hook Form) e revalidado no
 * servidor (POST /api/apuracao).
 */
export const apuracaoFilterSchema = z
  .object({
    conta: z
      .string()
      .trim()
      .min(1, "Informe o número da conta")
      .max(20, "Conta muito longa")
      .regex(/^\d+$/, "A conta deve conter apenas dígitos"),
    dataInicio: z.string().regex(ISO_DATE, "Data de início inválida"),
    dataFim: z.string().regex(ISO_DATE, "Data de fim inválida"),
  })
  .superRefine((value, ctx) => {
    if (value.dataFim < value.dataInicio) {
      ctx.addIssue({
        code: "custom",
        path: ["dataFim"],
        message: "A data de fim deve ser maior ou igual à de início",
      });
    }
    if (value.dataFim > maxEndDateIso()) {
      ctx.addIssue({
        code: "custom",
        path: ["dataFim"],
        message:
          "A data de fim deve ser até ontem (a API não publica o dia corrente)",
      });
    }
    if (value.dataFim > addMonthsIso(value.dataInicio, 12)) {
      ctx.addIssue({
        code: "custom",
        path: ["dataFim"],
        message: "O intervalo máximo é de 12 meses",
      });
    }
  });

export type ApuracaoFilter = z.infer<typeof apuracaoFilterSchema>;
