export const NO_READABLE_TEXT_CN = [
  "画面中不得出现任何可读文字、字幕、字母、Logo、水印、包装文字、屏幕文字、招牌文字或随机字符。",
  "需要显示文字的区域保持干净、简洁、无字符。",
  "真实广告文案将在后期合成阶段添加。"
].join("\n");

export const NO_READABLE_TEXT_EN = [
  "no readable text, no letters, no subtitles, no watermark,",
  "no typography, no logo text, no package text,",
  "no pseudo-text, no random symbols, no distorted words"
].join("\n");

export const NO_READABLE_TEXT_NEGATIVE = [
  "可读文字",
  "字母",
  "字幕",
  "水印",
  "排版文字",
  "Logo文字",
  "包装文字",
  "伪文字",
  "随机字符",
  "扭曲单词",
  "文字模糊",
  "文字扭曲"
].join("，");

export function appendNoReadableTextRules(prompt: string) {
  return [prompt.trim(), NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN].filter(Boolean).join("\n");
}
