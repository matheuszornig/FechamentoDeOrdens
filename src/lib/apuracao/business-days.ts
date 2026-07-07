/**
 * Lista os dias úteis (seg–sex) do intervalo [startIso, endIso], em ISO.
 * Feriados não são modelados: a API responde 404 ("sem notas") nesses dias e
 * a data fica cacheada como vazia — mesmo efeito prático, sem manter tabela
 * de feriados.
 */
export function listBusinessDays(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(d.toISOString().slice(0, 10));
    }
  }
  return days;
}
