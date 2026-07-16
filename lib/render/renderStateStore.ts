import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const renderStatusSchema = z.enum([
  "idle",
  "validating",
  "narrating",
  "bundling",
  "rendering",
  "encoding",
  "completed",
  "failed",
  "cancelled"
]);

export const renderErrorCodeSchema = z.enum([
  "KEYFRAME_MISSING",
  "HERO_VIDEO_MISSING",
  "INVALID_DURATION",
  "INVALID_ASPECT_RATIO",
  "MEDIA_UNREADABLE",
  "FONT_LOAD_FAILED",
  "BUNDLE_FAILED",
  "RENDER_FAILED",
  "ENCODE_FAILED",
  "RENDER_CANCELLED"
]);

export const renderStatusStateSchema = z.object({
  projectId: z.string().min(1),
  status: renderStatusSchema,
  progress: z.number().min(0).max(1),
  stage: z.string().min(1),
  outputUrl: z.string().nullable(),
  errorCode: renderErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  warningMessage: z.string().nullable().default(null),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable().default(null)
});

export type RenderStatus = z.infer<typeof renderStatusSchema>;
export type RenderErrorCode = z.infer<typeof renderErrorCodeSchema>;
export type RenderStatusState = z.infer<typeof renderStatusStateSchema>;

const stateCache = new Map<string, RenderStatusState>();
const DATA_DIR = path.join(process.cwd(), "data", "projects");

export function idleRenderState(projectId: string): RenderStatusState {
  return {
    projectId,
    status: "idle",
    progress: 0,
    stage: "等待渲染",
    outputUrl: null,
    errorCode: null,
    errorMessage: null,
    warningMessage: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null
  };
}

export async function getRenderState(projectId: string): Promise<RenderStatusState> {
  const safeProjectId = safeSegment(projectId);
  const cached = stateCache.get(safeProjectId);
  if (cached) return cached;

  try {
    const raw = await readFile(renderStatePath(safeProjectId), "utf8");
    const parsed = renderStatusStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      stateCache.set(safeProjectId, parsed.data);
      return parsed.data;
    }
  } catch {
    // Fresh projects do not have a render state yet.
  }

  return idleRenderState(safeProjectId);
}

export async function setRenderState(projectId: string, patch: Partial<RenderStatusState>): Promise<RenderStatusState> {
  const safeProjectId = safeSegment(projectId);
  const current = await getRenderState(safeProjectId);
  const next = renderStatusStateSchema.parse({
    ...current,
    ...patch,
    projectId: safeProjectId,
    updatedAt: new Date().toISOString()
  });
  stateCache.set(safeProjectId, next);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(renderStatePath(safeProjectId), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isActiveRenderStatus(status: RenderStatus) {
  return status === "validating" || status === "narrating" || status === "bundling" || status === "rendering" || status === "encoding";
}

export function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
}

function renderStatePath(projectId: string) {
  return path.join(DATA_DIR, `${projectId}.render.json`);
}


