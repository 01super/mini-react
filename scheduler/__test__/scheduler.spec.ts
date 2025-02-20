import { describe, test, expect } from "vitest";
import { isFn } from "shared/utils";

describe("scheduler", () => {
  test("isFn", () => {
    expect(isFn(() => {})).toBe(true);
  });
});
