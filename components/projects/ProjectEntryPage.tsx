"use client";

import { useRouter } from "next/navigation";
import { ProjectEntryDialog } from "./ProjectEntryDialog";

export function ProjectEntryPage({ notice }: { notice?: string }) {
  const router = useRouter();
  return <main className="project-entry-page">
    <ProjectEntryDialog open notice={notice} onClose={() => router.push("/")}
      onEnter={(projectId) => router.push(`/generate?projectId=${encodeURIComponent(projectId)}`)}
      onManage={() => router.push("/projects")} />
  </main>;
}
