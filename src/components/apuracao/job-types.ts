import type { ConsolidatedResult } from "@/lib/apuracao/types";

export type JobStatus =
  | "pendente"
  | "buscando"
  | "calculando"
  | "concluido"
  | "erro"
  | "cancelado";

export interface JobResponse {
  id: string;
  conta: string;
  dataInicio: string;
  dataFim: string;
  status: JobStatus;
  totalDates: number;
  processedDates: number;
  errorMessage: string | null;
  result: ConsolidatedResult | null;
  alerts: string[] | null;
  updatedAt: string;
  /** true quando o servidor está com BTG_USE_MOCK=true (dados simulados). */
  mock: boolean;
}

export function isActiveStatus(status: JobStatus): boolean {
  return (
    status === "pendente" || status === "buscando" || status === "calculando"
  );
}

export const MERCADO_LABEL: Record<string, string> = {
  bov: "Ações",
  option: "Opções",
  bmf: "Futuros",
  loan: "Aluguel",
};

export const MODALIDADE_LABEL: Record<string, string> = {
  day_trade: "Day trade",
  swing: "Swing",
  mista: "Mista",
  posicao: "Posição",
};
