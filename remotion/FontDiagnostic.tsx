import React from "react";
import { AbsoluteFill } from "remotion";
import { VideoText } from "./components/VideoText";
import { VIDEO_FONT_FAMILY } from "./load-fonts";

const TEST_LINES = [
  "中文字体测试：清醒续航，低糖不负担。",
  "English Font Test: LOW SUGAR COLD BREW",
  "数字与符号：1234567890，。！？¥8–15",
  "混排测试：AdDirector AI 广告生成 2026"
];

export function FontDiagnostic() {
  return (
    <AbsoluteFill style={{ background: "#05070c", padding: 96, justifyContent: "center", color: "#f8fafc" }}>
      <div style={{ display: "grid", gap: 42 }}>
        {[400, 500, 700].map((weight) => (
          <section key={weight} style={{ border: "1px solid rgba(255,255,255,0.14)", borderRadius: 24, padding: 30, background: "rgba(15,23,42,0.7)" }}>
            <div style={{ fontFamily: VIDEO_FONT_FAMILY, fontWeight: weight, fontSize: 26, color: "#7dd3fc", marginBottom: 16 }}>
              字重 {weight}
            </div>
            <div style={{ display: "grid", gap: 9 }}>
              {TEST_LINES.map((line) => (
                <VideoText key={`${weight}-${line}`} text={line} role="body" weight={weight as 400 | 500 | 700} maxLines={2} style={{ maxWidth: 1600, color: "#f8fafc" }}>
                  {line}
                </VideoText>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AbsoluteFill>
  );
}
