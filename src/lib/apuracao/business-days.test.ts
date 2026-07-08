import { describe, expect, it } from "vitest";
import { listBusinessDays } from "./business-days";

describe("listBusinessDays", () => {
  it("exclui sábados e domingos", () => {
    // 2026-01-05 é segunda; 2026-01-11 é domingo.
    expect(listBusinessDays("2026-01-05", "2026-01-11")).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
    ]);
  });

  it("intervalo de um único dia útil", () => {
    expect(listBusinessDays("2026-01-05", "2026-01-05")).toEqual([
      "2026-01-05",
    ]);
  });

  it("intervalo só com fim de semana é vazio", () => {
    expect(listBusinessDays("2026-01-10", "2026-01-11")).toEqual([]);
  });
});
