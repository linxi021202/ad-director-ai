import { describe, expect, it } from "vitest";
import { parseAspectRatio } from "../lib/media/aspect-ratio";

describe("parseAspectRatio", () => {
  it.each([
    ["9:16", 9, 16, "9 / 16", 0.5625, "portrait"],
    ["1:1", 1, 1, "1 / 1", 1, "square"],
    ["16:9", 16, 9, "16 / 9", 16 / 9, "landscape"]
  ] as const)("parses %s", (value, width, height, cssValue, numericRatio, orientation) => {
    expect(parseAspectRatio(value)).toEqual({ width, height, cssValue, numericRatio, orientation });
  });

  it("falls back to portrait when the value is invalid", () => {
    expect(parseAspectRatio("invalid")).toEqual(parseAspectRatio("9:16"));
  });
});
