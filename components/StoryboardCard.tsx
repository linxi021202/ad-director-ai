import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import { resolveProductImageUrl } from "@/lib/productImages";
import { KeyframePreview, type KeyframeResult } from "@/components/KeyframePreview";
import type { ShotDetailsTab } from "@/components/ShotDetailsSheet";
import { parseAspectRatio } from "@/lib/media/aspect-ratio";
import type { AspectRatio, ProductImage, StoryboardShot } from "@/lib/schemas/project";

type StoryboardCardProps = {
  shot: StoryboardShot;
  keyframe?: KeyframeResult;
  aspectRatio?: AspectRatio;
  onGenerateKeyframe?: (shot: StoryboardShot) => void;
  productImages?: ProductImage[];
  isHeroShot?: boolean;
  onSetHeroShot?: (shot: StoryboardShot) => void;
  onOpenDetails?: (shot: StoryboardShot, tab?: ShotDetailsTab) => void;
  onDeleteKeyframe?: (shot: StoryboardShot) => void;
  detailsOpen?: boolean;
};

export function StoryboardCard({
  shot,
  keyframe,
  aspectRatio = "9:16",
  onGenerateKeyframe,
  productImages = [],
  isHeroShot = false,
  onSetHeroShot,
  onOpenDetails,
  onDeleteKeyframe,
  detailsOpen = false
}: StoryboardCardProps) {
  const hasGenerated = keyframe?.status === "ready" || keyframe?.status === "failed";
  const isLoading = keyframe?.status === "loading";
  const imageUrl = keyframe?.localUrl || keyframe?.imageUrl;
  const showProductReference = shot.index === 4 && productImages.length > 0;
  const orientation = parseAspectRatio(aspectRatio).orientation;

  return (
    <article className={`keyframe-card-v3${isHeroShot ? " is-hero" : ""}`} data-orientation={orientation}>
      <div className="keyframe-card-v3__media">
        {isHeroShot ? <span className="keyframe-card-v3__hero-badge">当前主镜头</span> : null}
        <KeyframePreview result={keyframe} aspectRatio={aspectRatio} placeholderUrl={shotPlaceholderUrl(shot.index)} />
      </div>

      <div className="keyframe-card-v3__content">
        <header>
          <div><span>镜头 {shot.index}</span><h3>{shot.subtitle}</h3></div>
          <em>{shot.durationSec} 秒</em>
        </header>
        <p>{shot.visualDescription}</p>
        <div className="keyframe-card-v3__pills"><span>{shot.cameraAngle}</span><span>{shot.cameraMovement}</span></div>
        {keyframe?.fallbackUsed ? <span className="keyframe-fallback-badge"><i />本地降级图</span> : null}
        {showProductReference ? <ProductReferenceStrip images={productImages} /> : null}

        <div className="keyframe-card-v3__actions">
          {hasGenerated && imageUrl ? (
            <a className="keyframe-card-v3__primary" href={imageUrl} target="_blank" rel="noreferrer">查看大图</a>
          ) : (
            <button type="button" className="keyframe-card-v3__primary" disabled={isLoading} onClick={() => onGenerateKeyframe?.(shot)}>{isLoading ? "生成中" : "生成关键帧"}</button>
          )}
          <details className="keyframe-card-v3__menu">
            <summary aria-label={`镜头 ${shot.index} 更多操作`}>更多操作</summary>
            <div>
              <button type="button" onClick={() => onSetHeroShot?.(shot)} disabled={isHeroShot}>{isHeroShot ? "当前主镜头" : "设为主镜头"}</button>
              <button type="button" onClick={() => onGenerateKeyframe?.(shot)} disabled={isLoading}>{isLoading ? "生成中" : hasGenerated ? "重新生成" : "生成关键帧"}</button>
              <button type="button" aria-expanded={detailsOpen} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onOpenDetails?.(shot, "image"); }}>编辑提示词</button>
              <button type="button" aria-expanded={detailsOpen} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onOpenDetails?.(shot, "trace"); }}>查看生成详情</button>
              {hasGenerated ? <button type="button" onClick={() => onDeleteKeyframe?.(shot)}>删除结果</button> : null}
            </div>
          </details>
        </div>
        <button type="button" className="keyframe-card-v3__details-trigger" aria-expanded={detailsOpen} onClick={() => onOpenDetails?.(shot, "image")}>查看生成详情</button>
      </div>
    </article>
  );
}

function ProductReferenceStrip({ images }: { images: ProductImage[] }) {
  return (
    <div className="product-reference-v3">
      <div><strong>结尾行动画面产品图</strong><p>Remotion 合成时使用真实产品图，避免包装变形。</p></div>
      <div>{images.slice(0, 3).map((image) => { const source = resolveProductImageUrl(image); return source ? <AdaptiveMediaFrame key={image.id} aspectRatio="1:1" stage="product" src={source} mediaType="image" fit="contain" showBlurredBackdrop={false} alt={image.name} /> : null; })}</div>
    </div>
  );
}

function shotPlaceholderUrl(index: number) {
  if (index === 2) return "/demo-keyframes/shot-2.png";
  if (index === 3) return "/demo-keyframes/shot-3.png";
  if (index === 4) return "/demo-keyframes/shot-4.png";
  return "/landing-cold-brew-hero.png";
}
