import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getSessionStorageNamespace, resolveInsideStorage, toStorageRelativePath } from "@/lib/assets/path";
import { projectAssetManifestSchema, type ProjectAssetRecord } from "@/lib/assets/types";
import { anonymousProjectIdSchema, listAnonymousProjects } from "./anonymousProjectStore";

const queues = new Map<string, Promise<unknown>>();
const archiveSchema = projectAssetManifestSchema.extend({ projectName: z.string() });

export function isUploadedVideo(asset: ProjectAssetRecord) {
  return asset.mimeType.startsWith("video/") &&
    ["user-upload", "happyhorse-manual-import"].includes(asset.source);
}

function sessionDirectory(sessionId: string) {
  return resolveInsideStorage("sessions", getSessionStorageNamespace(sessionId));
}

async function readJson(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}

async function assertRegularDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("UNSAFE_WORKSPACE_PATH");
}

export async function listArchivedVideos(sessionId: string) {
  const root = path.join(sessionDirectory(sessionId), "uploaded-videos");
  const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const groups = [];
  for (const id of entries) {
    if (!anonymousProjectIdSchema.safeParse(id).success) continue;
    const directory = path.join(root, id);
    await assertRegularDirectory(directory);
    const raw = await readJson(path.join(directory, "assets.json"));
    if (!raw) continue;
    const archive = archiveSchema.parse(raw);
    groups.push({ projectId: id, ...archive, assets: archive.assets.filter((asset) =>
      asset.projectId === id && isUploadedVideo(asset) &&
      asset.storageRelativePath.startsWith(`${toStorageRelativePath(directory)}/assets/${asset.id}/`)) });
  }
  return groups;
}

export async function getArchivedVideo(sessionId: string, projectId: string, assetId: string) {
  if (!anonymousProjectIdSchema.safeParse(projectId).success) return null;
  const groups = await listArchivedVideos(sessionId);
  return groups.find((group) => group.projectId === projectId)?.assets.find((asset) => asset.id === assetId) ?? null;
}

export function resetWorkspaceForVisit(sessionId: string, visitId: string): Promise<{ reset: boolean; deferred: boolean; deletedProjects: number; preservedVideos: number }> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => reset(sessionId, visitId));
  queues.set(sessionId, next);
  void next.finally(() => { if (queues.get(sessionId) === next) queues.delete(sessionId); }).catch(() => undefined);
  return next;
}

async function reset(sessionId: string, visitId: string) {
  z.string().uuid().parse(visitId);
  const directory = sessionDirectory(sessionId);
  const marker = path.join(directory, "visit.json");
  const current = await readJson(marker) as { visitId?: string } | null;
  if (current?.visitId === visitId) return { reset: false, deferred: false, deletedProjects: 0, preservedVideos: 0 };
  const projects = await listAnonymousProjects(sessionId);
  // Keep the current visit usable without deleting assets that an outstanding task may still write.
  if (projects.some((record) => record.project.generationEvents?.some((event) =>
    ["queued", "running", "qa-review"].includes(event.status)))) {
    await mkdir(directory, { recursive: true });
    await assertRegularDirectory(directory);
    await atomicJson(marker, { visitId, updatedAt: Date.now() });
    return { reset: false, deferred: true, deletedProjects: 0, preservedVideos: 0 };
  }
  await mkdir(directory, { recursive: true });
  await assertRegularDirectory(directory);
  const projectsRoot = path.join(directory, "projects");
  const entries = await readdir(projectsRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length) await assertRegularDirectory(projectsRoot);
  let deletedProjects = 0;
  let preservedVideos = 0;
  for (const id of entries) {
    if (!anonymousProjectIdSchema.safeParse(id).success) throw new Error("UNSAFE_WORKSPACE_PATH");
    const projectDirectory = path.join(projectsRoot, id);
    await assertRegularDirectory(projectDirectory);
    const raw = await readJson(path.join(projectDirectory, "assets.json"));
    const uploads = raw ? projectAssetManifestSchema.parse(raw).assets.filter(isUploadedVideo) : [];
    if (uploads.length) {
      const archiveDirectory = path.join(directory, "uploaded-videos", id);
      await mkdir(archiveDirectory, { recursive: true });
      await assertRegularDirectory(archiveDirectory);
      const existingRaw = await readJson(path.join(archiveDirectory, "assets.json"));
      const existing = existingRaw ? archiveSchema.parse(existingRaw).assets : [];
      const archived = [...existing];
      for (const asset of uploads) {
        if (asset.projectId !== id) throw new Error("UNSAFE_WORKSPACE_PATH");
        const source = path.join(projectDirectory, "assets", asset.id);
        const destination = path.join(archiveDirectory, "assets", asset.id);
        const expectedPrefix = `${toStorageRelativePath(source)}/`;
        if (!asset.storageRelativePath.startsWith(expectedPrefix)) throw new Error("UNSAFE_WORKSPACE_PATH");
        const suffix = asset.storageRelativePath.slice(expectedPrefix.length);
        if (suffix !== path.basename(suffix)) throw new Error("UNSAFE_WORKSPACE_PATH");
        await mkdir(path.dirname(destination), { recursive: true });
        // Rename within the volume avoids copying large uploads and remains retryable after interruption.
        const sourceExists = await lstat(source).then(() => true).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
        if (sourceExists) { await assertRegularDirectory(source); await rename(source, destination); }
        await assertRegularDirectory(destination);
        const record = { ...asset, lifecycle: "active" as const,
          storageRelativePath: toStorageRelativePath(path.join(destination, suffix)) };
        const index = archived.findIndex((item) => item.id === asset.id);
        if (index >= 0) archived[index] = record; else archived.push(record);
        preservedVideos++;
      }
      await atomicJson(path.join(archiveDirectory, "assets.json"), {
        version: 1, projectName: "已保留的上传视频", assets: archived
      });
    }
    await rm(projectDirectory, { recursive: true, force: true });
    deletedProjects++;
  }
  for (const name of ["workspace.json", "model-calls.json"]) {
    await rm(path.join(directory, name), { force: true });
  }
  await atomicJson(marker, { visitId, updatedAt: Date.now() });
  return { reset: true, deferred: false, deletedProjects, preservedVideos };
}
