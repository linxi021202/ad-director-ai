import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const VIDEO_FONT_FAMILY = "AdDirector Sans";

export const VIDEO_FONT_FILES = [
  { fileName: "AdDirectorSans-Regular.woff2", weight: 400 },
  { fileName: "AdDirectorSans-Medium.woff2", weight: 500 },
  { fileName: "AdDirectorSans-Bold.woff2", weight: 700 }
] as const;

export const fontsReady = Promise.all(
  VIDEO_FONT_FILES.map(({ fileName, weight }) =>
    loadFont({
      family: VIDEO_FONT_FAMILY,
      url: staticFile(`fonts/${fileName}`),
      format: "woff2",
      weight: String(weight),
      display: "block"
    })
  )
).then(() => undefined);
