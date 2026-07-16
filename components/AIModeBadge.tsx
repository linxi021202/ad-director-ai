export type AITraceStatus = {
  mode: "mock" | "real";
  realTextEnabled: boolean;
  textModel: string;
  videoModel: string;
  manualVideoAssetPath: string;
  manualVideoAssetExists?: boolean;
  limits: {
    maxRealVideoShotsPerRun: number;
    maxVideoSecondsPerShot: number;
  };
};

type AIModeBadgeProps = { status: AITraceStatus };

export function AIModeBadge({ status }: AIModeBadgeProps) {
  const realTextMode = status.mode === "real" && status.realTextEnabled;

  return (
    <span className={realTextMode ? "inline-flex items-center gap-2 rounded-full border border-blue/25 bg-blue/10 px-3 py-1 text-xs font-semibold text-blue" : "inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-muted"}>
      <span className={realTextMode ? "h-1.5 w-1.5 rounded-full bg-blue" : "h-1.5 w-1.5 rounded-full bg-muted"} />
      {realTextMode ? "真实调用" : "模拟数据"}
    </span>
  );
}





