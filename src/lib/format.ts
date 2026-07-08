const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const int = new Intl.NumberFormat("pt-BR");

export function formatBRL(value: number): string {
  return brl.format(value);
}

/** Positivos ganham sinal explícito: +R$ 1.234,56. */
export function formatBRLSigned(value: number): string {
  return value > 0 ? `+${brl.format(value)}` : brl.format(value);
}

export function formatInt(value: number): string {
  return int.format(value);
}

export function formatPercent(value: number): string {
  return `${int.format(Math.round(value))}%`;
}

/** "2026-01-05" → "05/01/2026" */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-01-05" → "05/01" */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Classe de cor por sinal do P/L (verde positivo, vermelho negativo). */
export function plClass(value: number): string {
  if (value > 0) return "text-emerald-700 dark:text-emerald-500";
  if (value < 0) return "text-red-700 dark:text-red-500";
  return "text-muted-foreground";
}
