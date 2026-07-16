import { requireApiUser } from "@/lib/auth/api";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { assertServerOnly } from "@/lib/server-only";
import { safeSegment } from "@/lib/render/renderStateStore";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac"
};

type RouteContext = { params: Promise<{ projectId: string }> };
type NarrationAsset = {
  projectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  createdAt: string;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  assertServerOnly("narration asset route");
  const projectId = await getProjectId(context);
  const asset = await readAsset(projectId);
  return json(true, { exists: Boolean(asset), asset }, null, 200);
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  assertServerOnly("narration asset route");
  try {
    const projectId = await getProjectId(context);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) return json(false, null, "请选择旁白音频文件。", 400);
    const extension = MIME_EXTENSIONS[file.type];
    if (!extension) return json(false, null, "旁白仅支持 MP3、WAV、M4A 或 AAC。", 400);
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      return json(false, null, "旁白音频不能为空且不能超过 20MB。", 400);
    }

    const directory = assetDirectory(projectId);
    await mkdir(directory, { recursive: true });
    await Promise.all(["mp3", "wav", "m4a", "aac"].map((ext) =>
      rm(path.join(directory, "voiceover." + ext), { force: true })
    ));

    const fileName = "voiceover." + extension;
    await writeFile(path.join(directory, fileName), Buffer.from(await file.arrayBuffer()));
    const asset: NarrationAsset = {
      projectId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      publicUrl: "/generated/" + projectId + "/audio/" + fileName,
      createdAt: new Date().toISOString()
    };
    await mkdir(path.dirname(metadataPath(projectId)), { recursive: true });
    await writeFile(metadataPath(projectId), JSON.stringify(asset, null, 2), "utf8");
    return json(true, { exists: true, asset }, null, 201);
  } catch {
    return json(false, null, "旁白音频保存失败，请重新上传。", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  assertServerOnly("narration asset route");
  const projectId = await getProjectId(context);
  await rm(assetDirectory(projectId), { recursive: true, force: true });
  await rm(metadataPath(projectId), { force: true });
  return json(true, { exists: false, asset: null }, null, 200);
}

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return safeSegment(params.projectId);
}

async function readAsset(projectId: string): Promise<NarrationAsset | null> {
  try {
    const asset = JSON.parse(await readFile(metadataPath(projectId), "utf8")) as NarrationAsset;
    const filePath = path.join(process.cwd(), "public", asset.publicUrl.replace(/^\//, ""));
    const info = await stat(filePath);
    return info.isFile() && info.size > 0 ? asset : null;
  } catch {
    return null;
  }
}

function assetDirectory(projectId: string) {
  return path.join(process.cwd(), "public", "generated", projectId, "audio");
}

function metadataPath(projectId: string) {
  return path.join(process.cwd(), "data", "projects", projectId + ".narration.json");
}

function json(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({
    success,
    data,
    trace: { route: "project-narration" },
    fallbackUsed: false,
    fallbackReason: null,
    error
  }, { status });
}