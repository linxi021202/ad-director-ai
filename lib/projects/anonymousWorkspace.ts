import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getOwnedAnonymousProject, listAnonymousProjects } from "@/lib/projects/anonymousProjectStore";

const workspaceSchema = z.object({
  lastActiveProjectId: z.string().uuid().optional(),
  updatedAt: z.number().int().nonnegative()
}).strict();

export type AnonymousWorkspaceState = z.infer<typeof workspaceSchema>;

export async function getLastActiveProjectId(sessionId: string): Promise<string | undefined> {
  const state = await readWorkspace(sessionId);
  if (!state?.lastActiveProjectId) return undefined;
  const owned = await getOwnedAnonymousProject(sessionId, state.lastActiveProjectId);
  return owned ? state.lastActiveProjectId : undefined;
}

export async function setLastActiveProjectId(sessionId: string, projectId: string): Promise<void> {
  const owned = await getOwnedAnonymousProject(sessionId, projectId);
  if (!owned) throw new Error("PROJECT_NOT_FOUND");
  await writeWorkspace(sessionId, { lastActiveProjectId: projectId, updatedAt: Date.now() });
}

export async function clearLastActiveProjectId(sessionId: string): Promise<void> {
  await writeWorkspace(sessionId, { updatedAt: Date.now() });
}

export async function selectLastActiveProjectAfterDelete(sessionId: string, deletedProjectId: string): Promise<void> {
  const current = await readWorkspace(sessionId);
  if (current?.lastActiveProjectId !== deletedProjectId) return;
  const next = (await listAnonymousProjects(sessionId))[0];
  if (next) await writeWorkspace(sessionId, { lastActiveProjectId: next.id, updatedAt: Date.now() });
  else await clearLastActiveProjectId(sessionId);
}

async function readWorkspace(sessionId: string): Promise<AnonymousWorkspaceState | null> {
  try {
    return workspaceSchema.parse(JSON.parse(await readFile(workspacePath(sessionId), "utf8")));
  } catch (error) {
    if (isMissingFile(error)) return null;
    return null;
  }
}

async function writeWorkspace(sessionId: string, state: AnonymousWorkspaceState): Promise<void> {
  const destination = workspacePath(sessionId);
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(workspaceSchema.parse(state), null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function workspacePath(sessionId: string): string {
  const root = path.resolve(process.env.STORAGE_ROOT?.trim() || path.join(process.cwd(), "storage"));
  const namespace = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  const candidate = path.resolve(root, "sessions", namespace, "workspace.json");
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("UNSAFE_WORKSPACE_PATH");
  return candidate;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}