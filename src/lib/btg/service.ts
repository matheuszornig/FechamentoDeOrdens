import { BtgClient } from "./client";
import { MockBtgService } from "./mock";
import type { BtgService } from "./types";

let cached: BtgService | null = null;

/**
 * Factory única do serviço BTG: mock determinístico quando BTG_USE_MOCK=true
 * (Preview), cliente real caso contrário. Singleton por instância do runtime
 * para compartilhar o cache de token e o rate limiter.
 */
export function getBtgService(): BtgService {
  cached ??=
    process.env.BTG_USE_MOCK === "true"
      ? new MockBtgService()
      : new BtgClient();
  return cached;
}
