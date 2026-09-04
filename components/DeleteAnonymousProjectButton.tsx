"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAnonymousProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId), { method: "DELETE" });
      if (response.ok) router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return <button type="button" onClick={handleDelete} disabled={deleting}>
    {deleting ? "删除中" : "删除项目"}
  </button>;
}