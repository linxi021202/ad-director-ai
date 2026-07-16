"use client";

import { Player } from "@remotion/player";
import { FontDiagnostic } from "../remotion/FontDiagnostic";

export function FontDiagnosticPlayer() {
  return (
    <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
      <Player
        component={FontDiagnostic}
        durationInFrames={150}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        controls
        style={{ width: "100%", aspectRatio: "16 / 9" }}
      />
    </div>
  );
}
