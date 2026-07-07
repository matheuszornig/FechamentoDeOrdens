import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";

/** Clock falso: sleep avança o relógio, sem timers reais. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

describe("RateLimiter", () => {
  it("permite até o limite sem esperar", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(50, 60_000, clock.now, clock.sleep);
    for (let i = 0; i < 50; i++) {
      await limiter.acquire();
    }
    expect(clock.sleeps).toHaveLength(0);
    expect(limiter.available()).toBe(0);
  });

  it("não excede 50 requisições por janela de 60s", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(50, 60_000, clock.now, clock.sleep);
    const grants: number[] = [];
    for (let i = 0; i < 120; i++) {
      await limiter.acquire();
      grants.push(clock.now());
    }
    // Em qualquer janela deslizante de 60s cabem no máximo 50 aquisições.
    for (const start of grants) {
      const inWindow = grants.filter((t) => t >= start && t < start + 60_000);
      expect(inWindow.length).toBeLessThanOrEqual(50);
    }
  });

  it("retoma após a janela expirar", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(50, 60_000, clock.now, clock.sleep);
    for (let i = 0; i < 50; i++) {
      await limiter.acquire();
    }
    // 51ª precisa esperar a janela.
    await limiter.acquire();
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.now()).toBeGreaterThanOrEqual(60_000);

    // Depois de 60s ociosos, a janela abre de novo sem espera.
    clock.advance(61_000);
    const sleepsBefore = clock.sleeps.length;
    for (let i = 0; i < 49; i++) {
      await limiter.acquire();
    }
    expect(clock.sleeps.length).toBe(sleepsBefore);
  });
});
