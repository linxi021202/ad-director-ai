import { NextResponse } from "next/server";
import { z } from "zod";

import { buildModelCallExport, modelCallExportMarkdown } from "@/lib/logs/modelCallExport";
import { projectStoreErrorResponse } from "@/lib/projects/api";
import { getAnonymousApiSession } from "@/lib/session/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  format: z.enum(["json", "markdown"])
});

export async function GET(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const query = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ projectId: query.get("projectId"), taskId: query.get("taskId") ?? undefined, format: query.get("format") });
  if (!parsed.success) return NextResponse.json({ error: "导出参数无效。" }, { status: 400 });
  try {
    const report = await buildModelCallExport(sessionResult.session.id, parsed.data);
    if (parsed.data.taskId && !report.entries.length) return NextResponse.json({ error: "当前项目不存在该任务日志。" }, { status: 404 });
    const markdown = parsed.data.format === "markdown";
    const body = markdown ? modelCallExportMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const filename = `AdDirectorAI_${markdown ? "调用诊断" : "调用日志"}_${stamp}.${markdown ? "md" : "json"}`;
    return new Response(markdown ? `\uFEFF${body}` : body, {
      headers: {
        "content-type": `${markdown ? "text/markdown" : "application/json"}; charset=utf-8`,
        "content-disposition": `attachment; filename="AdDirectorAI_logs_${stamp}.${markdown ? "md" : "json"}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
        "x-log-retention-limited": report.retention.limitReached ? "true" : "false"
      }
    });
  } catch (error) {
    return projectStoreErrorResponse(error) ?? NextResponse.json({ error: "调用日志导出失败，请稍后重试。" }, { status: 500 });
  }
}
