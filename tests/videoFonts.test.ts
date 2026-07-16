import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertVideoFontsAvailable, VIDEO_FONT_ASSETS, VideoFontLoadError } from "../lib/render/videoFonts";

describe("local Remotion video fonts", () => {
  it("bundles exactly the supported 400, 500 and 700 WOFF2 weights", async () => {
    expect(VIDEO_FONT_ASSETS.map((font) => font.weight)).toEqual([400, 500, 700]);
    await expect(assertVideoFontsAvailable()).resolves.toBeUndefined();
    for (const font of VIDEO_FONT_ASSETS) {
      const bytes = await readFile(path.join(process.cwd(), "public", "fonts", font.fileName));
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
    }
  });

  it("stops rendering with FONT_LOAD_FAILED when a local font is unavailable", async () => {
    const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "addirector-font-test-"));
    try {
      await expect(assertVideoFontsAvailable(emptyRoot)).rejects.toMatchObject({
        code: "FONT_LOAD_FAILED"
      } satisfies Partial<VideoFontLoadError>);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
