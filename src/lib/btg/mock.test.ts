import { describe, expect, it } from "vitest";
import { listBusinessDays } from "@/lib/apuracao/business-days";
import { generateMockPayload, MockBtgService } from "./mock";

describe("mock determinístico", () => {
  it("mesma consulta → mesmas notas", () => {
    const a = generateMockPayload("12345", "2026-03-10");
    const b = generateMockPayload("12345", "2026-03-10");
    expect(a).toEqual(b);
  });

  it("contas ou datas diferentes → notas diferentes", () => {
    const a = JSON.stringify(generateMockPayload("12345", "2026-03-10"));
    const b = JSON.stringify(generateMockPayload("99999", "2026-03-10"));
    const c = JSON.stringify(generateMockPayload("12345", "2026-03-11"));
    expect(a === b && a === c).toBe(false);
  });

  it("gera dias 404 (sem notas) para exercitar o cache", async () => {
    const service = new MockBtgService();
    const days = listBusinessDays("2026-01-01", "2026-03-31");
    const results = await Promise.all(
      days.map((d) => service.fetchNotes("12345", d)),
    );
    const empty = results.filter((r) => r.kind === "empty").length;
    const withNotes = results.filter((r) => r.kind === "notes").length;
    expect(empty).toBeGreaterThan(0);
    expect(withNotes).toBeGreaterThan(0);
  });

  it("payload passa pelo mapper e produz notas normalizadas válidas", async () => {
    const service = new MockBtgService();
    const days = listBusinessDays("2026-01-01", "2026-01-31");
    for (const day of days) {
      const result = await service.fetchNotes("12345", day);
      if (result.kind !== "notes") continue;
      for (const note of result.notes) {
        expect(note.accountNumber).toBe("12345");
        expect(note.date).toBe(day);
        expect(note.noteNumber).not.toBe("");
        for (const trade of note.trades) {
          expect(trade.quantity).toBeGreaterThan(0);
          expect(trade.grossValue).toBeGreaterThan(0);
          expect(trade.ticker).not.toBe("string");
        }
      }
    }
  });
});
