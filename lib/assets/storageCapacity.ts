import "server-only";

import { mkdir, statfs } from "node:fs/promises";
import { getStorageRoot } from "./path";

const MB = 1024 * 1024;
export const STORAGE_METADATA_RESERVE_BYTES = 16 * MB;
export const IMAGE_STORAGE_BUDGET_BYTES = 16 * MB;
export const STORAGE_CAPACITY_MESSAGE = "服务器素材存储空间不足，已暂停图片生成，避免生成后无法保存。请先扩容存储或清理不需要的素材，再重试。";

export type StorageCapacity = {
  freeBytes: number;
  totalBytes: number;
  freeInodes: number;
  imageGenerationReady: boolean;
};

export class StorageCapacityError extends Error {
  readonly code: "STORAGE_CAPACITY_LOW" | "STORAGE_UNAVAILABLE";
  constructor(code: StorageCapacityError["code"], readonly capacity?: StorageCapacity) {
    super(code === "STORAGE_CAPACITY_LOW" ? STORAGE_CAPACITY_MESSAGE : "服务器素材存储暂不可用，尚未请求图像模型，请稍后重试或联系管理员。");
    this.name = "StorageCapacityError";
    this.code = code;
  }
}

export async function readStorageCapacity(): Promise<StorageCapacity> {
  const root = getStorageRoot();
  await mkdir(root, { recursive: true });
  const stats = await statfs(root);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeInodes = Number(stats.ffree);
  const hasInodes = Number(stats.files) === 0 || freeInodes > 0;
  return { freeBytes, totalBytes, freeInodes,
    imageGenerationReady: hasInodes && freeBytes >= STORAGE_METADATA_RESERVE_BYTES + IMAGE_STORAGE_BUDGET_BYTES };
}

export async function assertImageStorageCapacity(imageCount = 1): Promise<StorageCapacity> {
  let capacity: StorageCapacity;
  try { capacity = await readStorageCapacity(); }
  catch (error) {
    if (isStorageFullError(error)) throw new StorageCapacityError("STORAGE_CAPACITY_LOW");
    throw new StorageCapacityError("STORAGE_UNAVAILABLE");
  }
  const requiredBytes = STORAGE_METADATA_RESERVE_BYTES + IMAGE_STORAGE_BUDGET_BYTES * Math.max(1, imageCount);
  if (!capacity.imageGenerationReady || capacity.freeBytes < requiredBytes) throw new StorageCapacityError("STORAGE_CAPACITY_LOW", capacity);
  return capacity;
}

export function isStorageFullError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && (error.code === "ENOSPC" || error.code === "EDQUOT"))
    || (error instanceof Error && /ENOSPC|EDQUOT|no space left on device|disk quota exceeded/i.test(error.message));
}
