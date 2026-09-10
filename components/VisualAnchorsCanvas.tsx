"use client";

import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import type { GenerationProject, VisualAnchorCandidateKind } from "@/lib/schemas/project";
import { currentMasterAssetId, getVisualAnchorReadiness } from "@/lib/visual/visualAnchors";

type Props = {
  project: GenerationProject;
  busyTarget: string | null;
  onInitialize: () => void;
  onGenerateCandidates: (kind: VisualAnchorCandidateKind, targetId: string) => void;
  onSetCurrent: (kind: VisualAnchorCandidateKind, targetId: string, candidateId: string) => void;
  onLockMaster: (kind: "product" | VisualAnchorCandidateKind, targetId?: string) => void;
};

export function VisualAnchorsCanvas({
  project,
  busyTarget,
  onInitialize,
  onGenerateCandidates,
  onSetCurrent,
  onLockMaster
}: Props) {
  const workspace = project.visualAnchorWorkspace;
  const readiness = getVisualAnchorReadiness(project);
  const mainProduct = project.brief.productImages?.find((image) => image.role === "main-product")
    ?? project.brief.productImages?.find((image) => image.role !== "logo");
  const references = project.brief.productImages?.filter((image) => image.role === "reference") ?? [];

  return (
    <section className="visual-anchor-canvas" aria-label="视觉基准工作区">
      <header className="visual-anchor-toolbar">
        <div>
          <h2>Identity Gate</h2>
          <p>先确认不会变化的身份，再让后续镜头改变构图、动作、表情和光线。</p>
        </div>
        <button type="button" className="button-secondary-v3" disabled={busyTarget !== null} onClick={onInitialize}>
          {busyTarget === "initialize" ? "整理中" : "刷新基准需求"}
        </button>
      </header>

      <section className="anchor-gate-summary" aria-label="视觉基准完成度">
        <AnchorGateMetric label="Product Master" ready={readiness.productLocked} detail={productMissingLabel(readiness.missingProductReason)} />
        <AnchorGateMetric label="Character Masters" ready={readiness.missingCharacterIds.length === 0} detail={readiness.missingCharacterIds.length ? `还需确认 ${readiness.missingCharacterIds.length} 个` : "全部已锁定"} />
        <AnchorGateMetric label="Scene Masters" ready={readiness.missingSceneIds.length === 0} detail={readiness.missingSceneIds.length ? `还需确认 ${readiness.missingSceneIds.length} 个` : "全部已锁定"} />
      </section>

      <section className="anchor-work-section anchor-product-section" id="anchor-product">
        <AnchorSectionHeader
          label="Product Master"
          title="产品身份基准"
          version={workspace?.productMaster.version ?? 1}
          locked={Boolean(workspace?.productMaster.locked)}
        />
        <div className="anchor-product-layout">
          <div className="anchor-product-media">
            {mainProduct?.assetId ? (
              <AdaptiveMediaFrame
                aspectRatio="1:1"
                stage="product"
                src={`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(mainProduct.assetId)}`}
                mediaType="image"
                fit="contain"
                showBlurredBackdrop={false}
                alt={mainProduct.name}
              />
            ) : <div className="anchor-media-empty"><strong>缺少真实产品图片</strong><span>返回商品简报上传主产品。</span></div>}
          </div>
          <div className="anchor-product-spec">
            <p className="anchor-purpose-copy">产品身份基准。只能来自用户上传的真实产品图片，不由 AI 重新设计。</p>
            <dl>
              <SpecRow label="保真模式" value="Exact" />
              <SpecRow label="容器类型" value={project.productVisualSpec?.containerType ?? "等待分析"} />
              <SpecRow label="轮廓" value={project.productVisualSpec?.shape ?? "等待分析"} />
              <SpecRow label="比例" value={project.productVisualSpec?.proportions ?? "等待分析"} />
              <SpecRow label="材质" value={project.productVisualSpec?.materials.join("、") ?? "等待分析"} />
            </dl>
            <div className="anchor-reference-strip">
              <span>补充参考</span>
              <p>可选。同一产品的侧面、45°或细节照片。</p>
              <strong>{references.length} / 2</strong>
            </div>
            {!workspace?.productMaster.locked ? (
              <button
                type="button"
                className="button-primary-v3"
                disabled={busyTarget !== null || !mainProduct?.assetId || project.productVisualSpec?.sourceAssetId !== mainProduct.assetId}
                onClick={() => onLockMaster("product")}
              >
                {busyTarget === "lock:product" ? "锁定中" : "锁定 Product Master"}
              </button>
            ) : <p className="anchor-lock-confirmation">已锁定真实产品像素与 Product Visual Spec。</p>}
          </div>
        </div>
      </section>

      {(project.characterVisualSpecs ?? []).map((spec) => {
        const brief = workspace?.characterBriefs.find((item) => item.id === spec.id);
        const selectedAssetId = currentMasterAssetId(spec);
        const candidates = workspace?.characterCandidates.filter((item) => item.targetId === spec.id && (item.status !== "outdated" || item.assetId === selectedAssetId)) ?? [];
        return (
          <section className="anchor-work-section" id={`anchor-character-${spec.id}`} key={spec.id}>
            <AnchorSectionHeader label="Character Master" title={spec.role} version={spec.version ?? 1} locked={spec.locked} />
            <div className="anchor-identity-grid">
              <div className="anchor-brief-panel">
                <h3>Character Brief</h3>
                <dl>
                  <SpecRow label="年龄观感" value={brief?.apparentAgeRange ?? spec.apparentAgeRange ?? "待确认"} />
                  <SpecRow label="脸部" value={brief?.faceAppearance ?? spec.faceAppearance ?? spec.faceDescription} />
                  <SpecRow label="发型" value={`${spec.hairstyle} · ${spec.hairColor}`} />
                  <SpecRow label="服装" value={brief?.wardrobe ?? spec.wardrobe.join("、")} />
                  <SpecRow label="体型" value={spec.bodyBuild} />
                </dl>
                <div className="anchor-state-list">
                  <span>Identity / State 分离</span>
                  {(brief?.states ?? spec.states ?? []).map((state) => <p key={state.id}><strong>{state.label}</strong>{state.description}</p>)}
                </div>
              </div>
              <div className="anchor-candidate-panel">
                <CandidateHeader
                  count={candidates.length}
                  label="人物候选"
                  actionLabel="生成人物候选 · 3 张"
                  busy={busyTarget === `generate:character:${spec.id}`}
                  disabled={busyTarget !== null}
                  onGenerate={() => onGenerateCandidates("character", spec.id)}
                />
                <div className="anchor-candidate-grid">
                  {candidates.length ? candidates.map((candidate) => (
                    <AnchorCandidate
                      key={candidate.id}
                      projectId={project.id}
                      candidate={candidate}
                      selected={selectedAssetId === candidate.assetId}
                      locked={spec.locked && selectedAssetId === candidate.assetId}
                      busy={busyTarget !== null}
                      onSelect={() => onSetCurrent("character", spec.id, candidate.id)}
                    />
                  )) : <CandidateEmpty kind="人物" />}
                </div>
                {selectedAssetId && !spec.locked ? <button type="button" className="button-primary-v3" disabled={busyTarget !== null} onClick={() => onLockMaster("character", spec.id)}>{busyTarget === `lock:character:${spec.id}` ? "锁定中" : "锁定 Character Master"}</button> : null}
              </div>
            </div>
          </section>
        );
      })}

      {(project.sceneVisualSpecs ?? []).map((spec) => {
        const selectedAssetId = currentMasterAssetId(spec);
        const candidates = workspace?.sceneCandidates.filter((item) => item.targetId === spec.id && (item.status !== "outdated" || item.assetId === selectedAssetId)) ?? [];
        return (
          <section className="anchor-work-section" id={`anchor-scene-${spec.id}`} key={spec.id}>
            <AnchorSectionHeader label="Scene Master" title={spec.name} version={spec.version ?? 1} locked={spec.locked} />
            <div className="anchor-identity-grid">
              <div className="anchor-brief-panel">
                <h3>Scene Identity</h3>
                <p className="anchor-purpose-copy">摄影机可以变化，空间结构和主要物体关系保持固定。</p>
                <dl>
                  <SpecRow label="空间结构" value={spec.architecture} />
                  <SpecRow label="固定家具" value={spec.furniture.join("、") || "无"} />
                  <SpecRow label="主要道具" value={spec.heroProps.join("、") || "无"} />
                </dl>
                <div className="scene-layout-map">
                  <span>Spatial Anchors</span>
                  {spec.layout?.anchors.map((anchor) => <p key={anchor.id}><strong>{anchor.id}</strong><em>{anchor.semanticPosition}</em></p>)}
                </div>
                <div className="anchor-state-list">
                  <span>Scene States</span>
                  {spec.states?.map((state) => <p key={state.id}><strong>{state.label}</strong>{state.lighting}</p>)}
                </div>
              </div>
              <div className="anchor-candidate-panel">
                <CandidateHeader
                  count={candidates.length}
                  label="场景候选"
                  actionLabel="生成场景候选 · 3 张"
                  busy={busyTarget === `generate:scene:${spec.id}`}
                  disabled={busyTarget !== null}
                  onGenerate={() => onGenerateCandidates("scene", spec.id)}
                />
                <div className="anchor-candidate-grid is-scene">
                  {candidates.length ? candidates.map((candidate) => (
                    <AnchorCandidate
                      key={candidate.id}
                      projectId={project.id}
                      candidate={candidate}
                      selected={selectedAssetId === candidate.assetId}
                      locked={spec.locked && selectedAssetId === candidate.assetId}
                      busy={busyTarget !== null}
                      onSelect={() => onSetCurrent("scene", spec.id, candidate.id)}
                    />
                  )) : <CandidateEmpty kind="场景" />}
                </div>
                {selectedAssetId && !spec.locked ? <button type="button" className="button-primary-v3" disabled={busyTarget !== null} onClick={() => onLockMaster("scene", spec.id)}>{busyTarget === `lock:scene:${spec.id}` ? "锁定中" : "锁定 Scene Master"}</button> : null}
              </div>
            </div>
          </section>
        );
      })}
    </section>
  );
}

function AnchorSectionHeader({ label, title, version, locked }: { label: string; title: string; version: number; locked: boolean }) {
  return <header className="anchor-section-header"><div><span>{label}</span><h2>{title}</h2></div><div><em>V{version}</em><strong className={locked ? "is-locked" : ""}>{locked ? "Locked" : "待确认"}</strong></div></header>;
}

function CandidateHeader({ count, label, actionLabel, busy, disabled, onGenerate }: { count: number; label: string; actionLabel: string; busy: boolean; disabled: boolean; onGenerate: () => void }) {
  return <header className="anchor-candidate-header"><div><h3>{label}</h3><span>{count ? `${count} 个独立资产` : "尚未生成"}</span></div><button type="button" className="button-secondary-v3" disabled={disabled} onClick={onGenerate}>{busy ? "生成中" : actionLabel}</button></header>;
}

function AnchorCandidate({ projectId, candidate, selected, locked, busy, onSelect }: { projectId: string; candidate: NonNullable<GenerationProject["visualAnchorWorkspace"]>["characterCandidates"][number]; selected: boolean; locked: boolean; busy: boolean; onSelect: () => void }) {
  return (
    <article className={`anchor-candidate${selected ? " is-selected" : ""}${locked ? " is-locked" : ""}`}>
      <AdaptiveMediaFrame aspectRatio={candidate.kind === "scene" ? "16:9" : "9:16"} stage="auto" src={`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(candidate.assetId)}`} mediaType="image" fit="cover" alt={candidate.label} />
      <footer><div><strong>{candidate.label}</strong><span>{locked ? "Locked Master" : selected ? "Current" : `Asset ${candidate.assetId.slice(0, 8)}`}</span></div>{!locked ? <button type="button" disabled={busy || selected} onClick={onSelect}>{selected ? "Current" : "Set Current"}</button> : null}</footer>
    </article>
  );
}

function CandidateEmpty({ kind }: { kind: string }) {
  return <div className="anchor-candidate-empty"><strong>尚无{kind}候选</strong><span>每个候选都会生成独立 assetId，不使用拼图。</span></div>;
}

function AnchorGateMetric({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className={ready ? "is-ready" : ""}><i aria-hidden="true" /><span>{label}</span><strong>{ready ? "Ready" : detail}</strong></div>;
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function productMissingLabel(reason: ReturnType<typeof getVisualAnchorReadiness>["missingProductReason"]) {
  if (reason === "PRODUCT_REFERENCE_REQUIRED") return "缺少真实主产品";
  if (reason === "PRODUCT_VISUAL_SPEC_REQUIRED") return "等待视觉身份分析";
  if (reason === "PRODUCT_MASTER_NOT_LOCKED") return "等待用户锁定";
  return "已锁定";
}
