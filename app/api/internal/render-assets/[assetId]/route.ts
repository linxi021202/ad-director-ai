import "server-only";

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { resolveRenderAssetGrant } from "@/lib/assets/renderAccess";

type RouteContext = { params: Promise<{ assetId: string }> };
type ByteRange = { start: number; end: number };

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context);
}

async function handle(request: Request, context: RouteContext) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const { assetId } = await context.params;
  const grant = resolveRenderAssetGrant(token, assetId);
  if (!grant) return notFound();

  try {
    const bytes = await readFile(grant.filePath);
    const range = parseRange(request.headers.get("range"), bytes.length);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Type": grant.mimeType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff"
    });

    if (range === "invalid") {
      headers.set("Content-Range", `bytes */${bytes.length}`);
      return new NextResponse(null, { status: 416, headers });
    }

    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      const body = request.method === "HEAD"
        ? null
        : bytes.subarray(range.start, range.end + 1);
      return new NextResponse(body, { status: 206, headers });
    }

    headers.set("Content-Length", String(bytes.length));
    return new NextResponse(request.method === "HEAD" ? null : bytes, {
      status: 200,
      headers
    });
  } catch {
    return notFound();
  }
}

function parseRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  if (!value.startsWith("bytes=") || value.includes(",")) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return "invalid";
  }

  return { start, end: Math.min(end, size - 1) };
}

function notFound() {
  return NextResponse.json(
    { success: false, data: null, error: "ASSET_NOT_FOUND" },
    { status: 404 }
  );
}