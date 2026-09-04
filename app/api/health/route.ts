import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { access, mkdir, statfs } from "node:fs/promises";

import { getStorageRoot } from "@/lib/assets/path";
import { assertVideoFontsAvailable } from "@/lib/render/videoFonts";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    storageWritable: false,
    storageFreeBytes: null as number | null,
    videoFonts: false,
    browserExecutable: false,
    ownershipSalt: process.env.NODE_ENV !== "production" || Boolean(process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT?.trim())
  };

  try {
    const storageRoot = getStorageRoot();
    await mkdir(storageRoot, { recursive: true });
    await access(storageRoot, constants.R_OK | constants.W_OK);
    checks.storageWritable = true;
    const stats = await statfs(storageRoot);
    checks.storageFreeBytes = Number(stats.bavail * stats.bsize);
  } catch {
    checks.storageWritable = false;
  }

  try {
    await assertVideoFontsAvailable();
    checks.videoFonts = true;
  } catch {
    checks.videoFonts = false;
  }

  checks.browserExecutable = await hasBrowserExecutable();
  const ready = checks.storageWritable
    && checks.videoFonts
    && checks.browserExecutable
    && checks.ownershipSalt;

  return NextResponse.json({
    status: ready ? "ok" : "not-ready",
    service: "ad-director-ai",
    checks,
    timestamp: new Date().toISOString()
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}

async function hasBrowserExecutable() {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  const candidates = [
    configured,
    process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium",
    process.platform === "win32" ? "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium-browser",
    process.platform === "win32" ? "C:/Program Files/Microsoft/Edge/Application/msedge.exe" : "/usr/bin/google-chrome"
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue through the supported browser locations.
    }
  }
  return false;
}
