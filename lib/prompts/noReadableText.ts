export const NO_READABLE_TEXT_CN = [
  "除用户提供的真实产品参考图中原本已经存在的包装文字和Logo外，AI生成区域不得出现任何可读文字。禁止生成汉字、英文字母、数字、字幕、Logo文字、屏幕文字、包装新文字、招牌、标签、价格、水印、随机字符、伪文字或变形文字。用户真实产品上的原有文字只能通过原始产品素材保留，不得由模型重新绘制。",
  "电脑、手机、文档、海报、菜单、便利贴、广告牌和招牌若非剧情必需则不要出现；必须出现时保持屏幕空白、界面抽象失焦、文档无可读文字、海报空白。",
  "真实广告文案、品牌名、字幕与 CTA 仅由 Remotion 后期合成。"
].join("\n");

export const NO_READABLE_TEXT_EN = [
  "No generated readable text anywhere in the AI-generated regions. No Chinese characters, English letters, numbers, subtitles, screen text, signs, labels, generated logo text, package copy, prices, watermarks, pseudo-text, distorted words or random symbols.",
  "Text and logos already present in the user's original product asset may only be preserved from the original source asset and must never be redrawn by the generative model.",
  "Avoid text-bearing props. Required screens are blank or defocused, documents contain no readable text, and posters are blank."
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
