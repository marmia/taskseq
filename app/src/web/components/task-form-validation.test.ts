import { describe, expect, it } from "vitest";
import { taskTimingIssues } from "./task-form-validation";

describe("taskTimingIssues", () => {
  it("reports a missing recurring Start without evaluating its date", () => {
    expect(
      taskTimingIssues({
        start: "",
        startTime: "",
        due: "",
        dueTime: "",
        recurrenceRule: "day",
      }),
    ).toEqual([
      {
        field: "start",
        message: "A Recurring Task must use a date-only Start",
      },
    ]);
  });
});
