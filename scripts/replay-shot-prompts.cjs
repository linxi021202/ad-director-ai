/* Server-side diagnostic replay. --commit or --image explicitly creates an isolated test copy. */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const swc = require("next/dist/build/swc");
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  const output = swc.transformSync(fs.readFileSync(filename, "utf8"), {
    filename, jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" }
  });
  module._compile(output.code, filename);
};

async function main() {
  const args = process.argv.slice(2);
  const recordPath = args[0];
  if (!recordPath || !path.isAbsolute(recordPath)) throw new Error("An absolute project snapshot path is required.");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const { generationProjectSchema, detailedShotPromptPackageSchema } = require("../lib/schemas/project.ts");
  const { expandShotPrompts } = require("../lib/providers/deepseekProvider.ts");
  const { reviewDetailedPromptPackage } = require("../lib/director/promptQualityReview.ts");
  const { buildShotPromptInputFingerprint } = require("../lib/prompts/shotPromptFingerprint.ts");
  let project = generationProjectSchema.parse(record.project);
  const shotId = args.find((arg) => arg.startsWith("--shot="))?.slice(7) || "shot-01";
  const shot = project.shots.find((item) => item.id === shotId);
  const draft = project.shotPromptDrafts?.find((item) => item.shotId === shotId);
  if (!shot || !draft) throw new Error("The requested shot and its saved draft must exist.");
  const input = { brief: project.brief, strategy: project.strategy, shot,
    previousShot: project.shots.find((item) => item.index === shot.index - 1), productVisualSpec: project.productVisualSpec,
    visualContinuityBible: project.visualContinuityBible, referencePack: project.referencePack };
  const calls = [];
  const result = await expandShotPrompts(input, { resumeShotPromptDraft: draft,
    onModelCall: async (call) => { calls.push(call); } });
  const report = { sourceProjectId: project.id, shotId, promptSuccess: result.success, promptElapsedMs: result.latencyMs,
    foundationReused: Boolean(draft.foundation), savedFrameCount: draft.framePrompts.length,
    frameIds: result.data?.framePrompts.map((frame) => frame.frameId), qualityIssues: result.qualityIssues,
    qaPassed: result.data ? reviewDetailedPromptPackage(result.data).passed : false,
    error: result.error, calls, imageRequested: false };
  if (result.success && result.data && (args.includes("--commit") || args.includes("--image"))) {
    const store = require("../lib/projects/anonymousProjectStore.ts");
    const { importPrivateAssetFile, getPrivateAsset } = require("../lib/assets/assetStore.ts");
    const { selectImageReferencesForShot } = require("../lib/image/referenceSelector.ts");
    const { generateShotImage } = require("../lib/providers/providerRouter.ts");
    const { startGenerationEvent, completeGenerationEvent, failGenerationEvent } = require("../lib/projects/generationEvents.ts");
    const { upsertModelCallLog } = require("../lib/logs/modelCallStore.ts");
    const { isShotPromptReady } = require("../lib/prompts/shotPromptReadiness.ts");
    const { commitFinalPromptBundle } = require("../lib/prompts/promptCommit.ts");
    const sessionId = randomUUID();
    const copy = await store.createAnonymousProject(sessionId, { name: "镜头提示词诊断副本" });
    const sourceProjectId = project.id;
    const sourceDirectory = args.find((arg) => arg.startsWith("--assets="))?.slice(9) || path.dirname(recordPath);
    const remap = (value) => {
      if (typeof value === "string") return value.replaceAll(`/api/projects/${sourceProjectId}/`, `/api/projects/${copy.id}/`);
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
      return value;
    };
    project = (await store.mutateOwnedAnonymousProject(sessionId, copy.id, () => ({ ...remap(project), id: copy.id }))).project;
    const clonedShot = project.shots.find((item) => item.id === shotId);
    const references = selectImageReferencesForShot(project, clonedShot);
    const referenceIds = new Set([...references.masterReferenceAssetIds, ...references.productImages.map((image) => image.assetId)]);
    if (project.productVisualSpec?.sourceAssetId) referenceIds.add(project.productVisualSpec.sourceAssetId);
    const manifest = args.includes("--image") ? JSON.parse(fs.readFileSync(path.join(sourceDirectory, "assets.json"), "utf8")) : undefined;
    for (const assetId of args.includes("--image") ? referenceIds : []) {
      const asset = manifest.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error(`Reference asset missing: ${assetId}`);
      const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(root, "storage"));
      const sourcePath = path.resolve(storageRoot, asset.storageRelativePath);
      if (!sourcePath.startsWith(storageRoot + path.sep)) throw new Error("Reference asset is outside storage.");
      await importPrivateAssetFile(sessionId, copy.id, { assetId: asset.id, kind: asset.kind, role: asset.role, source: asset.source,
        fileName: asset.fileName, mimeType: asset.mimeType, sourcePath, width: asset.width, height: asset.height });
    }
    const copyInput = { ...input, brief: project.brief, shot: clonedShot, previousShot: project.shots.find((item) => item.index === clonedShot.index - 1), productVisualSpec: project.productVisualSpec,
      visualContinuityBible: project.visualContinuityBible, referencePack: project.referencePack };
    const promptPackage = detailedShotPromptPackageSchema.parse({ ...result.data, schemaVersion: 2,
      inputFingerprint: buildShotPromptInputFingerprint(copyInput) });
    const promptEvent = await startGenerationEvent(sessionId, copy.id, { stage: "prompts", provider: "deepseek", shotId,
      action: "验证提示词最终提交", message: "复用已保存结果，只验证最终组装、保存和任务完成。" });
    const committed = await commitFinalPromptBundle({ sessionId, projectId: copy.id, shotId, taskId: promptEvent.id, jobId: promptEvent.runId },
      promptPackage, promptPackage.inputFingerprint, project.productVisualSpec, result.latencyMs);
    project = (await store.requireOwnedAnonymousProject(sessionId, copy.id)).project;
    report.commit = { taskId: promptEvent.id, status: project.generationEvents.find((event) => event.id === promptEvent.id)?.status,
      promptReady: isShotPromptReady(project, project.shots.find((item) => item.id === shotId)), warnings: committed.warnings };
    report.diagnosticProjectId = copy.id;
    if (args.includes("--image")) {
    const readyShot = project.shots.find((item) => item.id === shotId);
    if (!isShotPromptReady(project, readyShot)) throw new Error("Final QA must pass before requesting an image.");
    const frame = readyShot.frames[0];
    const event = await startGenerationEvent(sessionId, copy.id, { stage: "keyframes", provider: "qwen-image", shotId,
      frameId: frame.id, action: "诊断单帧关键帧", message: "复用已保存提示词，仅验证第一帧图片生成。" });
    const moment = frame.keyframeMoment;
    const frameMoment = moment ? `关键帧时间 ${moment.timestampSec.toFixed(2)} 秒。画面目的：${moment.narrativePurpose}。确定状态：${moment.momentDescription}。人物姿态：${moment.characterPose}；手部：${moment.handState}；视线：${moment.gazeDirection}；产品位置：${moment.productPosition}；机位：${moment.cameraAngle}。与前一帧的连续性：${moment.continuityFromPreviousFrame}。` : "";
    const backgroundMoment = moment ? `人物姿态：${moment.characterPose}；手部状态：${moment.handState}；视线：${moment.gazeDirection}；机位：${moment.cameraAngle}。` : "";
    const frameShot = { ...readyShot, id: `${readyShot.id}--${frame.id}`,
      visualDescription: `${backgroundMoment}${frame.description}`,
      imagePromptCn: `${frameMoment}\n${frame.imagePromptCn}\n硬性要求：只生成一个冻结瞬间的一张完整全画幅图片。禁止分镜板、网格、拼贴、接触表、前后对比和多面板。`,
      imagePromptEn: `${frame.imagePromptEn}\nHARD CONSTRAINT: Generate exactly one frozen moment as one full-frame image. No storyboard, grid, collage, contact sheet, before/after layout, split screen, or multiple panels.`,
      negativePromptCn: [frame.negativePromptCn, readyShot.negativePromptCn, "多面板，拼贴，分镜板，网格，接触表，前后对比，分屏，多时刻"].filter(Boolean).join("，"),
      negativePromptEn: [frame.negativePromptEn, readyShot.negativePromptEn, "multi-panel, collage, storyboard, grid, contact sheet, before-after, split screen, multiple moments"].filter(Boolean).join(", ") };
    report.imageRequested = true;
    const image = await generateShotImage(copy.id, frameShot, { aspectRatio: project.brief.aspectRatio, sessionId,
      productImages: references.productImages, productImage: references.productImages[0], productVisualSpec: project.productVisualSpec,
      masterReferenceAssetIds: references.masterReferenceAssetIds,
      onModelAttempt: async (attempt) => {
        calls.push({ promptStage: undefined, model: attempt.model, status: attempt.status, errorCode: attempt.errorCode,
          durationMs: attempt.completedAt - attempt.startedAt });
        await upsertModelCallLog(sessionId, { kind: "call", taskId: event.id, jobId: event.runId, projectId: copy.id,
          stage: "keyframes", provider: "qwen-image", model: attempt.model, shotId, frameId: frame.id,
          status: attempt.status, attempt: attempt.attempt, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
          durationMs: attempt.completedAt - attempt.startedAt, errorCode: attempt.errorCode, errorSummary: attempt.error,
          providerErrorCode: attempt.providerErrorCode, httpStatus: attempt.httpStatus, providerRequestId: attempt.requestId });
      }
    });
    const savedAsset = image.assetId ? await getPrivateAsset(sessionId, copy.id, image.assetId) : null;
    report.image = { success: !image.fallbackUsed && Boolean(savedAsset), model: image.model, elapsedMs: image.latencyMs,
      assetSaved: Boolean(savedAsset), assetId: image.assetId, errorCode: image.errorCode, error: image.error };
    report.diagnosticProjectId = copy.id;
    if (report.image.success) await completeGenerationEvent(sessionId, copy.id, event.id, "诊断图片已生成并保存。", { latencyMs: image.latencyMs });
    else await failGenerationEvent(sessionId, copy.id, event.id, image.error || "诊断图片未生成成功。", image.errorCode);
    }
  }
  const output = args.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, calls: calls.map((call) => ({ mode: call.mode, model: call.model,
    promptStage: call.promptStage, status: call.status, success: call.success, finalUsed: call.finalUsed, errorCode: call.errorCode })) }));
  if (!report.promptSuccess || report.image && !report.image.success) process.exitCode = 2;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
