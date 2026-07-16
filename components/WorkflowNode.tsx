type WorkflowNodeProps = {
  label: string;
  detail?: string;
  active?: boolean;
};

export function WorkflowNode({ label, detail, active = false }: WorkflowNodeProps) {
  return (
    <div className="flex min-w-[132px] flex-1 items-stretch">
      <div className={active ? "w-full rounded-xl border border-blue/25 bg-blue/10 p-4" : "w-full rounded-xl border border-line bg-panel p-4"}>
        <div className={active ? "text-sm font-semibold text-blue" : "text-sm font-semibold text-mist"}>{label}</div>
        {detail ? <p className="mt-2 text-xs leading-5 text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}