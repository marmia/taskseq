import { describe, expect, it } from "vitest";
import type { Area } from "../domain/task";
import { activeAreasInPositionOrder } from "./settings-store";

describe("activeAreasInPositionOrder", () => {
  it("returns a restored Area in its position order", () => {
    const areas: Area[] = [
      {
        id: 3,
        name: "Music",
        color: "green",
        position: 3,
        isSystemManaged: false,
      },
      {
        id: 2,
        name: "Develop",
        color: "purple",
        position: 2,
        isSystemManaged: false,
      },
      {
        id: 1,
        name: "AI/IT",
        color: "blue",
        position: 1,
        isSystemManaged: false,
      },
      {
        id: 4,
        name: "Inbox",
        color: "gray",
        position: 0,
        isSystemManaged: true,
      },
    ];

    expect(activeAreasInPositionOrder(areas).map((area) => area.id)).toEqual([
      1, 2, 3,
    ]);
  });
});
