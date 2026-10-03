type TaskEntry = {
  kind: "task" | "call";
  taskId: string;
  stage: string;
  shotId?: string | null;
  status: string;
  startedAt: number;
};

function taskPriority(status: string) {
  if (["queued", "running", "qa-review"].includes(status)) return 0;
  if (["failed", "interrupted"].includes(status)) return 1;
  return 2;
}

export function resolveScopedTask<T extends TaskEntry>(entries: readonly T[], stage: string, shotId: string): T | undefined {
  return entries.filter((entry) => entry.kind === "task" && entry.stage === stage && entry.shotId === shotId)
    .sort((left, right) => taskPriority(left.status) - taskPriority(right.status)
      || right.startedAt - left.startedAt || right.taskId.localeCompare(left.taskId))[0];
}
