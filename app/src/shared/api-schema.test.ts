import { describe, expect, it } from "vitest";
import {
  createAreaRequestSchema,
  createTaskRequestSchema,
  displayLanguageSchema,
  renameTagRequestSchema,
  viewConditionSchema,
  viewCreateRequestSchema,
} from "./api-schema";

describe("display language schema", () => {
  it("accepts supported BCP 47 language codes and rejects unsupported codes", () => {
    expect(displayLanguageSchema.parse("en")).toBe("en");
    expect(displayLanguageSchema.parse("ja")).toBe("ja");
    expect(displayLanguageSchema.safeParse("fr").success).toBe(false);
  });
});

describe("View condition schema", () => {
  it("accepts date-only operators and rejects timestamps or the legacy range", () => {
    const singleOperators = [
      "equals",
      "before",
      "after",
      "onOrBefore",
      "onOrAfter",
    ] as const;

    for (const operator of singleOperators) {
      expect(
        viewConditionSchema.parse({
          field: "start",
          operator,
          value: "2026-08-10",
        }),
      ).toEqual({
        field: "start",
        operator,
        value: "2026-08-10",
      });
    }

    expect(
      viewConditionSchema.parse({
        field: "due",
        operator: "between",
        value: { from: "2026-08-10", to: "2026-08-10" },
      }),
    ).toEqual({
      field: "due",
      operator: "between",
      value: { from: "2026-08-10", to: "2026-08-10" },
    });
    expect(
      viewConditionSchema.parse({
        field: "due",
        operator: "isUnset",
        value: null,
      }),
    ).toEqual({ field: "due", operator: "isUnset", value: null });

    expect(
      viewConditionSchema.safeParse({
        field: "start",
        operator: "equals",
        value: "2026-08-10T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      viewConditionSchema.safeParse({
        field: "start",
        operator: "isWithin",
        value: { from: "2026-08-10", to: "2026-08-10" },
      }).success,
    ).toBe(false);
  });

  it("allows multiple Start or Due conditions but rejects other duplicate fields", () => {
    expect(
      viewCreateRequestSchema.safeParse({
        name: "Combined dates",
        allTasks: false,
        conditions: [
          { field: "start", operator: "onOrAfter", value: "2026-08-10" },
          { field: "start", operator: "before", value: "2026-08-12" },
        ],
      }).success,
    ).toBe(true);
    expect(
      viewCreateRequestSchema.safeParse({
        name: "Duplicate titles",
        allTasks: false,
        conditions: [
          { field: "title", operator: "contains", value: "one" },
          { field: "title", operator: "contains", value: "two" },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes Tag names and supports both Tag operators", () => {
    expect(
      viewConditionSchema.parse({
        field: "tag",
        operator: "containsAll",
        value: [" API ", "api", "BETA", ""],
      }),
    ).toEqual({
      field: "tag",
      operator: "containsAll",
      value: ["api", "beta"],
    });

    expect(
      viewConditionSchema.parse({
        field: "tag",
        operator: "containsNone",
        value: ["frontend"],
      }),
    ).toEqual({
      field: "tag",
      operator: "containsNone",
      value: ["frontend"],
    });
  });

  it("rejects Tag IDs and empty Tag conditions", () => {
    expect(
      viewConditionSchema.safeParse({
        field: "tag",
        operator: "containsAll",
        value: [1],
      }).success,
    ).toBe(false);
    expect(
      viewCreateRequestSchema.safeParse({
        name: "Future Tags",
        allTasks: false,
        conditions: [{ field: "tag", operator: "containsNone", value: [] }],
      }).success,
    ).toBe(false);
  });

  it("rejects commas in Tag names while preserving Task Tag normalization", () => {
    expect(
      renameTagRequestSchema.safeParse({ name: "release,ready" }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: "Task",
        areaId: 1,
        start: null,
        due: null,
        description: "",
        tagIds: [],
        newTagNames: ["release,ready"],
      }).success,
    ).toBe(false);
  });

  it("normalizes Area names without changing case and rejects Area IDs", () => {
    expect(
      viewConditionSchema.parse({
        field: "area",
        operator: "isAnyOf",
        value: [" Inbox ", "Develop", "Develop", "", "develop"],
      }),
    ).toEqual({
      field: "area",
      operator: "isAnyOf",
      value: ["Inbox", "Develop", "develop"],
    });
    expect(
      viewConditionSchema.safeParse({
        field: "area",
        operator: "isAnyOf",
        value: [2],
      }).success,
    ).toBe(false);
    expect(
      viewCreateRequestSchema.safeParse({
        name: "Empty Areas",
        allTasks: false,
        conditions: [{ field: "area", operator: "isAnyOf", value: ["", "  "] }],
      }).success,
    ).toBe(false);
  });

  it("rejects commas in Area names", () => {
    expect(
      createAreaRequestSchema.safeParse({
        name: "Work, Personal",
        color: "blue",
      }).success,
    ).toBe(false);
    expect(
      viewConditionSchema.safeParse({
        field: "area",
        operator: "isAnyOf",
        value: ["Work, Personal"],
      }).success,
    ).toBe(false);
  });
});
