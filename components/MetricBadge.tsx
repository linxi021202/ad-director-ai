type MetricBadgeProps = {
  label: string;
  value: string;
  tone?: "cyan" | "violet" | "slate";
};

const toneClass = {
  cyan: "border-blue/25 bg-blue/10 text-blue",
  violet: "border-line bg-panel text-mist",
  slate: "border-line bg-panel text-mist"
};

export function MetricBadge({ label, value, tone = "slate" }: MetricBadgeProps) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass[tone]}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}