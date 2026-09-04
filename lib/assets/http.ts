import "server-only";

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { assertPrivateAssetReadable } from "./assetStore";
import type { ProjectAssetRecord } from "./types";

export async function serveProjectAsset(
  request: Request,
  asset: ProjectAssetRecord,
  options: { download?: boolean } = {}
): Promise<NextResponse> {
  const filePath = await assertPrivateAssetReadable(asset);
  const bytes = await readFile(filePath);
  const range = parseRange(request.headers.get("range"), bytes.length);
  const headers = baseHeaders(asset, options.download ?? false);

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    return new NextResponse(null, { status: 416, headers });
  }

  if (range) {
    const body = request.method === "HEAD" ? null : bytes.subarray(range.start, range.end + 1);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new NextResponse(body, { status: 206, headers });
  }

  headers.set("Content-Length", String(bytes.length));
  return new NextResponse(request.method === "HEAD" ? null : bytes, { status: 200, headers });
}

function baseHeaders(asset: ProjectAssetRecord, download: boolean): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Type": asset.mimeType,
    "X-Content-Type-Options": "nosniff"
  });
  const disposition = download ? "attachment" : "inline";
  headers.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
  return headers;
}

function parseRange(value: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!value) return null;
  if (!/^bytes=/.test(value) || value.includes(",")) return "invalid";
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
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}
