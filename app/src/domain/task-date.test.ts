import { describe, expect, it } from "vitest";
import {
  defaultOwnerTimeZone,
  editedLocalDateTimeToTaskValue,
  formatTaskDate,
  formatTaskListDate,
  formatTaskListDateRange,
  isScheduledOpenTaskValue,
  isTaskDueBefore,
  localDateTimeToTaskValue,
  ownerWeekEndDate,
  taskDate,
  taskValueToLocalDateTime,
} from "./task-date";

describe("Task date values", () => {
  it("converts an owner-local date and time to an offset timestamp", () => {
    const value = localDateTimeToTaskValue(
      "2026-07-24T14:30",
      defaultOwnerTimeZone,
    );

    expect(value).toBe("2026-07-24T14:30:00.000+09:00");
    expect(taskDate(value, defaultOwnerTimeZone)).toBe("2026-07-24");
    expect(formatTaskDate(value, defaultOwnerTimeZone)).toBe("07-24 14:30");
  });

  it("compares date-only and timestamp Due values correctly", () => {
    const now = new Date("2026-07-24T15:00:00+09:00").getTime();

    expect(isTaskDueBefore("2026-07-24", "2026-07-24", now)).toBe(false);
    expect(
      isTaskDueBefore("2026-07-24T14:30:00.000+09:00", "2026-07-24", now),
    ).toBe(true);
  });

  it("keeps an unchanged date-only value while editing", () => {
    expect(taskValueToLocalDateTime("2026-07-24", defaultOwnerTimeZone)).toBe(
      "2026-07-24T00:00",
    );
    expect(
      editedLocalDateTimeToTaskValue(
        "2026-07-24T00:00",
        "2026-07-24",
        defaultOwnerTimeZone,
      ),
    ).toBe("2026-07-24");
  });

  it("calculates the week end from the Owner timezone", () => {
    const mondayAfterMidnightInTokyo = new Date(
      "2026-07-27T00:30:00+09:00",
    ).getTime();

    expect(
      ownerWeekEndDate(1, defaultOwnerTimeZone, mondayAfterMidnightInTokyo),
    ).toBe("2026-08-02");
  });

  it("includes the selected week end and excludes the following date", () => {
    const now = new Date("2026-08-12T12:00:00.000Z").getTime();
    const weekEnd = ownerWeekEndDate(0, defaultOwnerTimeZone, now);

    expect(weekEnd).toBe("2026-08-15");
    expect(
      isScheduledOpenTaskValue(
        { status: "OPEN", start: null, due: weekEnd },
        defaultOwnerTimeZone,
        weekEnd,
      ),
    ).toBe(true);
    expect(
      isScheduledOpenTaskValue(
        { status: "OPEN", start: null, due: "2026-08-16" },
        defaultOwnerTimeZone,
        weekEnd,
      ),
    ).toBe(false);
  });

  it("uses the selected Owner timezone for timestamp date boundaries", () => {
    const value = "2026-07-24T23:30:00.000-07:00";

    expect(taskDate(value, "America/Los_Angeles")).toBe("2026-07-24");
    expect(taskDate(value, "Asia/Tokyo")).toBe("2026-07-25");
  });

  it("formats Task list dates as owner-local short dates with the current year omitted", () => {
    const now = new Date("2026-08-31T12:00:00.000Z").getTime();

    expect(formatTaskListDate("2026-08-31", defaultOwnerTimeZone, now)).toBe(
      "8/31",
    );
    expect(
      formatTaskListDate("2025-12-31T23:30:00.000-08:00", "Asia/Tokyo", now),
    ).toBe("1/1");
    expect(formatTaskListDate("2025-12-31", defaultOwnerTimeZone, now)).toBe(
      "2025/12/31",
    );
  });

  it("formats Task list date ranges without exposing timestamp times", () => {
    const now = new Date("2026-08-31T12:00:00.000Z").getTime();

    expect(
      formatTaskListDateRange("2026-08-31", null, defaultOwnerTimeZone, now),
    ).toBe("8/31 →");
    expect(
      formatTaskListDateRange(null, "2026-08-31", defaultOwnerTimeZone, now),
    ).toBe("→ 8/31");
    expect(
      formatTaskListDateRange(
        "2026-08-31T09:00:00.000+09:00",
        "2026-09-05T18:00:00.000+09:00",
        defaultOwnerTimeZone,
        now,
      ),
    ).toBe("8/31 → 9/5");
    expect(
      formatTaskListDateRange(
        "2026-08-31",
        "2026-08-31T23:59:00.000+09:00",
        defaultOwnerTimeZone,
        now,
      ),
    ).toBe("8/31");
    expect(
      formatTaskListDateRange(null, null, defaultOwnerTimeZone, now),
    ).toBeNull();
  });

  it("selects a Due-only Task by its Owner-timezone date and gives Start precedence", () => {
    expect(
      isScheduledOpenTaskValue(
        {
          status: "OPEN",
          start: null,
          due: "2026-07-24T23:59:00.000+09:00",
        },
        defaultOwnerTimeZone,
        "2026-07-24",
      ),
    ).toBe(true);
    expect(
      isScheduledOpenTaskValue(
        {
          status: "OPEN",
          start: "2026-07-25",
          due: "2026-07-24",
        },
        defaultOwnerTimeZone,
        "2026-07-24",
      ),
    ).toBe(false);
    expect(
      isScheduledOpenTaskValue(
        {
          status: "OPEN",
          start: null,
          due: "2026-07-23",
        },
        defaultOwnerTimeZone,
        "2026-07-24",
      ),
    ).toBe(true);
  });
});
