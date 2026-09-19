import { describe, expect, it } from "vitest";
import { canHaveSubtask, MAX_TASK_DEPTH } from "./task";

describe("Task depth", () => {
  it("limits Task nesting to five levels without counting Area", () => {
    expect(MAX_TASK_DEPTH).toBe(5);
    expect(
      canHaveSubtask({
        path: ["Develop", "Level 1", "Level 2", "Level 3", "Level 4"],
      }),
    ).toBe(true);
    expect(
      canHaveSubtask({
        path: [
          "Develop",
          "Level 1",
          "Level 2",
          "Level 3",
          "Level 4",
          "Level 5",
        ],
      }),
    ).toBe(false);
  });
});
