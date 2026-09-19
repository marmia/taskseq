import { describe, expect, it } from "vitest";
import {
  nextOccurrenceDate,
  normalizeRecurrenceRule,
  recurrenceRuleMatchesDate,
} from "./recurrence";

describe("Recurrence Rule", () => {
  it("normalizes each supported syntax family", () => {
    expect(normalizeRecurrenceRule("day")).toBe("day");
    expect(normalizeRecurrenceRule("wed,mon")).toBe("mon, wed");
    expect(normalizeRecurrenceRule("10,5")).toBe("5, 10");
    expect(normalizeRecurrenceRule("3rd thu+2")).toBe("3rd thu + 2");
    expect(() => normalizeRecurrenceRule("mon, 5")).toThrow();
  });

  it("finds the next valid occurrence without backfilling missed dates", () => {
    expect(nextOccurrenceDate("mon, wed", "2026-07-28")).toBe("2026-07-29");
    expect(nextOccurrenceDate("31", "2026-04-15")).toBe("2026-05-31");
    expect(nextOccurrenceDate("5th mon", "2026-02-01")).toBe("2026-03-30");
    expect(nextOccurrenceDate("2nd tue - 1", "2026-07-01")).toBe("2026-07-13");
  });

  it("matches only dates selected by the rule", () => {
    expect(recurrenceRuleMatchesDate("mon, wed", "2026-07-29")).toBe(true);
    expect(recurrenceRuleMatchesDate("mon, wed", "2026-07-30")).toBe(false);
  });
});
