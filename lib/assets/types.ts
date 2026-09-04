import { z } from "zod";

export const projectAssetKindSchema = z.enum([
  "product-image",
  "logo",
  "reference-image",
  "keyframe",
  "hero-video",
  "narration-audio",
  "background-music",
  "final-video"
]);

export const projectAssetSourceSchema = z.enum([
  "user-upload",
  "qwen-image",
  "happyhorse-manual-import",
  "happyhorse-api",
  "remotion",
  "system-demo"
]);

export const projectAssetLifecycleSchema = z.enum(["active", "orphaned", "pending-cleanup"]);

export const projectAssetRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: projectAssetKindSchema,
  role: z.string().trim().min(1).max(80).optional(),
  source: projectAssetSourceSchema,
  fileName: z.string().trim().min(1).max(255),
  storageRelativePath: z.string().trim().min(1),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  lifecycle: projectAssetLifecycleSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const projectAssetManifestSchema = z.object({
  version: z.literal(1),
  assets: z.array(projectAssetRecordSchema)
}).strict();

export type ProjectAssetKind = z.infer<typeof projectAssetKindSchema>;
export type ProjectAssetSource = z.infer<typeof projectAssetSourceSchema>;
export type ProjectAssetLifecycle = z.infer<typeof projectAssetLifecycleSchema>;
export type ProjectAssetRecord = z.infer<typeof projectAssetRecordSchema>;
export type ProjectAssetManifest = z.infer<typeof projectAssetManifestSchema>;

export type PublicProjectAsset = Omit<ProjectAssetRecord, "storageRelativePath" | "checksumSha256"> & {
  url: string;
};
