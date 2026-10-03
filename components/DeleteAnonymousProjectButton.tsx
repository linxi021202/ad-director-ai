"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAnonymousProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("确认删除这个项目？项目内容和生成素材将无法恢复。")) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId), { method: "DELETE" });
      if (response.ok) {
        const result = await response.json() as { data?: { wasActive?: boolean } };
        if (result.data?.wasActive) router.push("/generate");
        else router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return <button type="button" onClick={handleDelete} disabled={deleting}>
    {deleting ? "删除中" : "删除项目"}
  </button>;
}
