/**
 * Rate limiter de janela deslizante: no máximo `maxRequests` aquisições por
 * janela de `windowMs`. O limite da API do BTG é 60 req/min; usamos 50/min
 * como margem de segurança (ver service.ts).
 *
 * Clock e sleep são injetáveis para testes determinísticos.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - this.windowMs;
      this.timestamps = this.timestamps.filter((t) => t > cutoff);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(this.now());
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = Math.max(oldest + this.windowMs - this.now(), 1);
      await this.sleep(waitMs);
    }
  }

  /** Quantas aquisições ainda cabem na janela atual (para diagnóstico). */
  available(): number {
    const cutoff = this.now() - this.windowMs;
    return this.maxRequests - this.timestamps.filter((t) => t > cutoff).length;
  }
}
