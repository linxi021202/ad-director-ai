"use client";

import Link from "next/link";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import type { GenerationProject, VisualAnchorCandidate, VisualAnchorCandidateKind } from "@/lib/schemas/project";
import { currentMasterAssetId, getVisualAnchorReadiness } from "@/lib/visual/visualAnchors";
import { getActionBlockers } from "@/lib/workflow/actionBlockers";
import { GuardedActionButton } from "@/components/workflow/GuardedActionButton";

type Props = {
  project: GenerationProject;
  busyTarget: string | null;
  onInitialize: () => void;
  onGenerateAll: () => void;
  onConfirmProduct: () => void;
  onGenerateCandidates: (kind: VisualAnchorCandidateKind, targetId: string) => void;
  onSetCurrent: (kind: VisualAnchorCandidateKind, targetId: string, candidateId: string) => void;
  onConfirmSelection: () => void;
};

export function VisualAnchorsCanvas({ project, busyTarget, onInitialize, onGenerateAll, onConfirmProduct, onGenerateCandidates, onSetCurrent, onConfirmSelection }: Props) {
  const workspace = project.visualAnchorWorkspace;
  const readiness = getVisualAnchorReadiness(project);
  const mainProduct = project.brief.productImages?.find((image) => image.role === "main-product")
    ?? project.brief.productImages?.find((image) => image.role !== "logo");
  const characters = (project.characterVisualSpecs ?? []).filter((item) => workspace?.requiredCharacterIds.includes(item.id));
  const scenes = (project.sceneVisualSpecs ?? []).filter((item) => workspace?.requiredSceneIds.includes(item.id));
  const hasCandidates = characters.every((spec) => activeCandidates(workspace?.characterCandidates, spec.id).length > 0)
    && scenes.every((spec) => activeCandidates(workspace?.sceneCandidates, spec.id).length > 0);

  return (
    <section className="visual-anchor-canvas" aria-label="视觉设定">
      <div className="visual-anchor-intro">
        <div><h2>产品、人物与场景</h2><p>确认后，这些形象会贯穿后续分镜和关键帧。</p></div>
        {!workspace ? <button type="button" className="button-primary-v3" disabled={busyTarget !== null} onClick={onInitialize}>{busyTarget ? "准备中" : "准备人物与场景"}</button>
          : !hasCandidates ? <GuardedActionButton className="button-primary-v3" blockers={getActionBlockers(project, "GENERATE_CHARACTER")} busy={busyTarget !== null} busyLabel="生成中…" onAction={onGenerateAll}>生成人物与场景候选</GuardedActionButton>
            : readiness.ready ? <span className="anchor-complete-state">人物与场景已确认</span>
              : <GuardedActionButton className="button-primary-v3" blockers={getActionBlockers(project, "CONFIRM_VISUAL_SETUP")} busy={busyTarget !== null} busyLabel="确认中…" onAction={onConfirmSelection}>确认人物与场景，继续制作分镜</GuardedActionButton>}
      </div>

      <section className="anchor-work-section anchor-product-section" id="anchor-product">
        <SectionTitle label="真实商品" title="产品图" status={readiness.productLocked ? "已确认" : mainProduct?.assetId ? "待确认" : "未开始"} />
        <div className="anchor-product-layout">
          <div className="anchor-product-media">
            {mainProduct?.assetId ? <AdaptiveMediaFrame aspectRatio="1:1" stage="product" src={assetUrl(project.id, mainProduct.assetId)} mediaType="image" fit="contain" showBlurredBackdrop={false} alt={mainProduct.name} />
              : <div className="anchor-media-empty"><strong>还没有主产品图</strong><span>请先回到商品信息上传真实图片。</span></div>}
          </div>
          <div className="anchor-product-spec">
            <strong>{mainProduct?.assetId ? "已使用你上传的真实产品图" : "请上传真实产品图"}</strong>
            <p>{mainProduct?.assetId ? "一致性保护已开启。后续广告将以这张真实商品图作为产品外观参考。" : "保存产品图片后即可开启一致性保护，外观分析不会阻止后续操作。"}</p>
            <div className="anchor-inline-actions">
              {mainProduct?.assetId ? <a href={assetUrl(project.id, mainProduct.assetId)} target="_blank" rel="noreferrer">查看原图</a> : null}
              <Link href={`/generate?projectId=${encodeURIComponent(project.id)}&stage=brief`}>更换产品图</Link>
            </div>
            {!readiness.productLocked ? <GuardedActionButton className="button-secondary-v3" blockers={getActionBlockers(project, "CONFIRM_PRODUCT")} busy={busyTarget === "lock:product"} busyLabel="确认中…" onAction={onConfirmProduct}>确认产品</GuardedActionButton> : <span className="anchor-lock-confirmation">产品已确认</span>}
            <details className="stage-provider-details"><summary>生成详情</summary><p>{project.productVisualSpec ? "已识别外形、材质与主要颜色，用于加强背景和光线适配。" : "图片分析未完成也不会阻止你继续选择人物和场景。"}</p></details>
          </div>
        </div>
      </section>

      <section className="anchor-work-section" id="anchor-characters">
        <SectionTitle label="广告角色" title="人物" status={characters.length === 0 ? "不需要" : readiness.missingCharacterIds.length ? "待确认" : "已确认"} />
        {characters.length === 0 ? <div className="anchor-friendly-empty"><strong>这个创意不需要出镜人物</strong><span>后续会以商品和场景推进叙事。</span></div> : characters.map((spec) => {
          const brief = workspace?.characterBriefs.find((item) => item.id === spec.id);
          const candidates = activeCandidates(workspace?.characterCandidates, spec.id);
          return <div className="visual-choice-module" key={spec.id}>
            <header><div><h3>{spec.role}</h3><p>{brief?.apparentAgeRange} · {brief?.wardrobe ?? spec.wardrobe.join("、")}</p></div><button type="button" className="button-secondary-v3" disabled={busyTarget !== null} onClick={() => onGenerateCandidates("character", spec.id)}>{busyTarget === `generate:character:${spec.id}` ? "生成中" : candidates.length ? "换一组" : "生成人物候选"}</button></header>
            <CandidateGrid projectId={project.id} candidates={candidates} selectedAssetId={currentMasterAssetId(spec)} busy={busyTarget !== null} onSelect={(candidateId) => onSetCurrent("character", spec.id, candidateId)} />
          </div>;
        })}
      </section>

      <section className="anchor-work-section" id="anchor-scenes">
        <SectionTitle label="拍摄空间" title="场景" status={readiness.missingSceneIds.length ? "待确认" : "已确认"} />
        {scenes.map((spec) => {
          const candidates = activeCandidates(workspace?.sceneCandidates, spec.id);
          return <div className="visual-choice-module" key={spec.id}>
            <header><div><h3>{spec.name}</h3><p>{spec.architecture}</p></div><button type="button" className="button-secondary-v3" disabled={busyTarget !== null} onClick={() => onGenerateCandidates("scene", spec.id)}>{busyTarget === `generate:scene:${spec.id}` ? "生成中" : candidates.length ? "换一组" : "生成场景候选"}</button></header>
            <CandidateGrid projectId={project.id} candidates={candidates} selectedAssetId={currentMasterAssetId(spec)} busy={busyTarget !== null} onSelect={(candidateId) => onSetCurrent("scene", spec.id, candidateId)} />
            <details className="stage-provider-details"><summary>场景变化范围</summary><p>构图和机位可以变化，场景状态只改变光线、天气和少量道具状态。</p></details>
          </div>;
        })}
      </section>
    </section>
  );
}

function CandidateGrid({ projectId, candidates, selectedAssetId, busy, onSelect }: { projectId: string; candidates: VisualAnchorCandidate[]; selectedAssetId?: string; busy: boolean; onSelect: (candidateId: string) => void }) {
  if (candidates.length === 0) return <div className="anchor-friendly-empty"><strong>还没有候选图</strong><span>生成后会在这里出现独立图片，不会使用拼图。</span></div>;
  return <div className={`anchor-candidate-grid${candidates[0]?.kind === "scene" ? " is-scene" : ""}`}>{candidates.map((candidate) => {
    const selected = candidate.assetId === selectedAssetId;
    return <article className={`anchor-candidate${selected ? " is-selected" : ""}`} key={candidate.id}>
      <AdaptiveMediaFrame aspectRatio={candidate.kind === "scene" ? "16:9" : "9:16"} stage="auto" src={assetUrl(projectId, candidate.assetId)} mediaType="image" fit="cover" alt={candidate.label} />
      <footer><div><strong>{candidate.label}</strong><span>{candidate.recommended ? "系统推荐" : selected ? "已选择" : "可选择"}</span></div><button type="button" disabled={busy || selected} onClick={() => onSelect(candidate.id)}>{selected ? "已选择" : "选择"}</button></footer>
    </article>;
  })}</div>;
}

function SectionTitle({ label, title, status }: { label: string; title: string; status: string }) {
  return <header className="anchor-section-header"><div><span>{label}</span><h2>{title}</h2></div><strong className={status === "已确认" ? "is-locked" : ""}>{status}</strong></header>;
}

function activeCandidates(candidates: VisualAnchorCandidate[] | undefined, targetId: string) {
  return candidates?.filter((item) => item.targetId === targetId && item.status !== "outdated") ?? [];
}

function assetUrl(projectId: string, assetId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
}
