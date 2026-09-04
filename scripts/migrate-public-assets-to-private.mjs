import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local"), override: false });
loadEnv({ path: path.join(process.cwd(), ".env"), override: false });

const args = new Set(process.argv.slice(2));
const valueOf = (name) => {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const sessionId = valueOf("--session-id");
const projectId = valueOf("--project-id");
const apply = args.has("--apply");

if (!sessionId || !projectId) {
  fail("Usage: node scripts/migrate-public-assets-to-private.mjs --session-id <id> --project-id <uuid> [--apply]");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
  fail("The project ID must be a UUID.");
}

const cwd = process.cwd();
const storageRoot = path.resolve(process.env.STORAGE_ROOT?.trim() || path.join(cwd, "storage"));
const sessionNamespace = sha256(sessionId).slice(0, 32);
const projectDirectory = inside(
  storageRoot,
  path.join(storageRoot, "sessions", sessionNamespace, "projects", projectId)
);
const projectPath = inside(storageRoot, path.join(projectDirectory, "project.json"));
const rawProject = await readFile(projectPath, "utf8").catch(() => null);
if (!rawProject) fail("Owned project record was not found in private storage.");

const record = JSON.parse(rawProject);
const ownershipSalt =
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT?.trim() ||
  "ad-director-local-ownership-salt";
if (record.id !== projectId || record.ownerFingerprint !== sha256(sessionId + ":" + ownershipSalt)) {
  fail("Project ownership verification failed.");
}

const candidates = await discoverCandidates(record.project, projectId);
if (candidates.length === 0) {
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    projectId,
    ownershipVerified: true,
    candidates: 0,
    message: "No legacy public assets were found."
  }, null, 2));
  process.exit(0);
}

const inspected = [];
for (const candidate of candidates) {
  const info = await stat(candidate.sourcePath).catch(() => null);
  const valid = Boolean(info?.isFile() && info.size > 0 && await signatureLooksValid(candidate));
  inspected.push({
    ...candidate,
    sizeBytes: info?.size ?? 0,
    valid
  });
}

if (!apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    projectId,
    ownershipVerified: true,
    candidates: inspected.map((item) => ({
      kind: item.kind,
      role: item.role,
      file: path.relative(cwd, item.sourcePath),
      sizeBytes: item.sizeBytes,
      valid: item.valid
    })),
    next: "Re-run with --apply after reviewing this output."
  }, null, 2));
  process.exit(inspected.every((item) => item.valid) ? 0 : 2);
}

if (inspected.some((item) => !item.valid)) {
  fail("Migration stopped because one or more legacy files failed signature validation.");
}

const manifestPath = inside(storageRoot, path.join(projectDirectory, "assets.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => '{"version":1,"assets":[]}'));
const migrated = [];
for (const item of inspected) {
  const assetId = randomUUID();
  const extension = path.extname(item.sourcePath).slice(1).toLowerCase() || extensionForMime(item.mimeType);
  const destinationDirectory = inside(
    storageRoot,
    path.join(projectDirectory, "assets", assetId)
  );
  const destination = inside(
    storageRoot,
    path.join(destinationDirectory, "source-file" + (extension ? "." + extension : ""))
  );
  await mkdir(destinationDirectory, { recursive: true });
  const temporary = destination + ".tmp-" + randomUUID();
  await copyFile(item.sourcePath, temporary);
  await rename(temporary, destination);
  const bytes = await readFile(destination);
  const now = new Date().toISOString();
  const asset = {
    id: assetId,
    projectId,
    kind: item.kind,
    role: item.role,
    source: item.source,
    fileName: path.basename(item.sourcePath),
    storageRelativePath: path.relative(storageRoot, destination).split(path.sep).join("/"),
    mimeType: item.mimeType,
    sizeBytes: bytes.length,
    checksumSha256: sha256(bytes),
    createdAt: now,
    updatedAt: now
  };
  manifest.assets.push(asset);
  applyProjectReference(record.project, item, assetId);
  migrated.push({ assetId, kind: item.kind, role: item.role });
}

record.updatedAt = Date.now();
record.version = Number(record.version || 0) + 1;
record.project.updatedAt = new Date(record.updatedAt).toISOString();
await writeJsonAtomic(manifestPath, manifest);
await writeJsonAtomic(projectPath, record);

console.log(JSON.stringify({
  mode: "apply",
  projectId,
  ownershipVerified: true,
  migrated,
  note: "Legacy public files were not deleted. Remove them only after verifying the private asset API."
}, null, 2));

async function discoverCandidates(project, id) {
  const result = [];
  for (const image of project.brief?.productImages || []) {
    if (image.assetId) continue;
    const sourcePath = safeLegacyPublicPath(image.url || image.localUrl || image.previewUrl);
    if (sourcePath) result.push({
      kind: image.role === "logo" ? "logo" : "product-image",
      role: image.role || "reference",
      source: "user-upload",
      sourcePath,
      mimeType: image.type || mimeFor(sourcePath),
      reference: { type: "product-image", imageId: image.id }
    });
  }

  for (const shot of project.shots || []) {
    const frame = (project.keyframes || []).find((item) => item.shotId === shot.id);
    if (frame?.assetId) continue;
    const sourcePath = path.join(cwd, "public", "generated", "images", id, "shot-" + shot.index + ".png");
    if (await exists(sourcePath)) result.push({
      kind: "keyframe",
      role: shot.id,
      source: "qwen-image",
      sourcePath,
      mimeType: "image/png",
      reference: { type: "keyframe", shotId: shot.id }
    });
  }

  if (!project.heroVideo?.assetId) {
    const sourcePath = path.join(cwd, "public", "generated", id, "video", "hero-shot.mp4");
    if (await exists(sourcePath)) result.push({
      kind: "hero-video",
      role: project.heroShotId || "shot-3",
      source: "happyhorse-manual-import",
      sourcePath,
      mimeType: "video/mp4",
      reference: { type: "hero-video" }
    });
  }

  if (!project.narrationAssetId) {
    const audioDirectory = path.join(cwd, "public", "generated", id, "audio");
    const names = await readdir(audioDirectory).catch(() => []);
    const name = names.find((entry) => ["voiceover.wav", "voiceover.mp3", "narration.wav", "narration.mp3"].includes(entry));
    if (name) {
      const sourcePath = path.join(audioDirectory, name);
      result.push({
        kind: "narration-audio",
        role: "voiceover",
        source: "user-upload",
        sourcePath,
        mimeType: mimeFor(sourcePath),
        reference: { type: "narration" }
      });
    }
  }

  if (!project.finalVideoAssetId) {
    const sourcePath = path.join(cwd, "public", "generated", id, "final", "ad-final.mp4");
    if (await exists(sourcePath)) result.push({
      kind: "final-video",
      role: "ad-final",
      source: "remotion",
      sourcePath,
      mimeType: "video/mp4",
      reference: { type: "final-video" }
    });
  }
  return result;
}

function applyProjectReference(project, item, assetId) {
  const url = "/api/projects/" + projectId + "/assets/" + assetId;
  if (item.reference.type === "product-image") {
    const image = (project.brief.productImages || []).find((entry) => entry.id === item.reference.imageId);
    if (image) {
      image.assetId = assetId;
      image.url = url;
      delete image.previewUrl;
      delete image.localUrl;
      delete image.remoteUrl;
    }
  } else if (item.reference.type === "keyframe") {
    const frame = (project.keyframes || []).find((entry) => entry.shotId === item.reference.shotId);
    if (frame) {
      frame.assetId = assetId;
      frame.imageUrl = url;
      frame.localUrl = url;
      frame.storageTransition = "PRIVATE_ASSET_V1";
    }
  } else if (item.reference.type === "hero-video") {
    project.heroVideo = {
      ...(project.heroVideo || {}),
      shotId: project.heroShotId || "shot-3",
      assetId,
      source: project.heroVideo?.source || "happyhorse-manual-import",
      status: "uploaded",
      url,
      fileName: path.basename(item.sourcePath),
      mimeType: "video/mp4",
      storageTransition: "PRIVATE_ASSET_V1"
    };
  } else if (item.reference.type === "narration") {
    project.narrationAssetId = assetId;
  } else if (item.reference.type === "final-video") {
    project.finalVideoAssetId = assetId;
    project.finalVideoUrl = url;
    project.finalVideo = {
      ...(project.finalVideo || {}),
      status: "completed",
      assetId,
      url,
      fileName: "ad-final.mp4",
      progress: 1,
      storageTransition: "PRIVATE_ASSET_V1"
    };
  }
}

function safeLegacyPublicPath(value) {
  if (typeof value !== "string" || !value.startsWith("/uploads/")) return null;
  const candidate = path.resolve(cwd, "public", value.slice(1));
  const publicRoot = path.resolve(cwd, "public");
  return candidate.startsWith(publicRoot + path.sep) ? candidate : null;
}

async function signatureLooksValid(item) {
  const bytes = await readFile(item.sourcePath);
  if (item.mimeType === "video/mp4") {
    return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (item.mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (item.mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (item.mimeType === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (item.mimeType === "audio/wav") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (item.mimeType === "audio/mpeg") {
    return bytes.length >= 3 && (bytes.subarray(0, 3).toString("ascii") === "ID3" || bytes[0] === 255);
  }
  return false;
}

function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg"
  }[extension] || "application/octet-stream";
}

function extensionForMime(mimeType) {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/wav": "wav",
    "audio/mpeg": "mp3"
  }[mimeType] || "";
}

async function exists(filePath) {
  const info = await stat(filePath).catch(() => null);
  return Boolean(info?.isFile());
}

async function writeJsonAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + ".tmp-" + randomUUID();
  await writeFile(temporary, JSON.stringify(value, null, 2) + String.fromCharCode(10), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}

function inside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(resolvedRoot + path.sep)) {
    fail("Resolved path escapes the private storage root.");
  }
  return resolvedCandidate;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}