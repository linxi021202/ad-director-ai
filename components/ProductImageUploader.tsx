"use client";

import { useEffect, useRef, useState } from "react";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import {
  createProductImageMetadata,
  formatFileSize,
  productImageErrorMessage,
  releaseOwnedProductImageUrl,
  removeProductImage,
  resolveProductImageUrl,
  setMainProductImage,
  validateProductImageFiles
} from "@/lib/productImages";
import type { ProductImage } from "@/lib/schemas/project";

type ProductImageUploaderProps = {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
  onPersistedVersion?: (version: number) => void;
  projectId?: string;
  disabled?: boolean;
};

type LocalUploadResponse = {
  success: boolean;
  data?: { assetId: string; localUrl: string; version: number } | null;
  error?: string;
};

const roleLabels: Record<ProductImage["role"], string> = {
  "main-product": "主产品",
  logo: "品牌标识",
  reference: "补充参考"
};

export function ProductImageUploader({ images, onChange, onPersistedVersion, projectId, disabled = false }: ProductImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  const [lightboxImage, setLightboxImage] = useState<ProductImage | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const addRoleRef = useRef<ProductImage["role"]>("main-product");
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const ownedUrlsRef = useRef<Set<string>>(new Set());
  const imagesRef = useRef(images);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => () => {
    for (const image of imagesRef.current) {
      releaseOwnedProductImageUrl(image, ownedUrlsRef.current);
    }
  }, []);

  async function persistLocalFile(file: File, image: ProductImage) {
    if (!projectId) return;

    setUploadingIds((current) => new Set(current).add(image.id));
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("projectId", projectId);
      body.append("assetId", image.id);
      body.append("role", image.role);
      const response = await fetch("/api/upload-product-image", { method: "POST", body });
      const payload = await response.json() as LocalUploadResponse;
      if (!response.ok || !payload.success || !payload.data?.localUrl) {
        throw new Error(payload.error || "本地素材保存失败");
      }

      const currentImages = imagesRef.current;
      const currentImage = currentImages.find((item) => item.id === image.id);
      if (!currentImage) return;
      releaseOwnedProductImageUrl(currentImage, ownedUrlsRef.current);
      const nextImages = currentImages.map((item) => item.id === image.id
        ? { ...item, assetId: payload.data!.assetId, localUrl: payload.data!.localUrl, previewUrl: undefined }
        : item);
      imagesRef.current = nextImages;
      onChange(nextImages);
      onPersistedVersion?.(payload.data.version);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? `${caughtError.message}，当前图片仅在本页临时可见。` : "本地素材保存失败。");
    } finally {
      setUploadingIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
    }
  }

  function createImage(file: File, role: ProductImage["role"], id: string) {
    const previewUrl = URL.createObjectURL(file);
    ownedUrlsRef.current.add(previewUrl);
    return createProductImageMetadata(file, previewUrl, role, id);
  }

  function openAddPicker(role: ProductImage["role"]) {
    addRoleRef.current = role;
    addInputRef.current?.click();
  }

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validation = validateProductImageFiles(files, images.length);
    if (!validation.success) {
      setError(productImageErrorMessage(validation.error));
      return;
    }

    const requestedRole = addRoleRef.current;
    const created = files.map((file, index) => createImage(
      file,
      requestedRole === "main-product" && index === 0 ? "main-product" : "reference",
      `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
    ));
    const nextImages = [...images, ...created];
    imagesRef.current = nextImages;
    onChange(nextImages);
    setError(null);
    created.forEach((image, index) => void persistLocalFile(files[index]!, image));
  }

  function handleReplace(file: File) {
    const targetId = replaceTargetRef.current;
    const target = images.find((image) => image.id === targetId);
    if (!target) return;
    const validation = validateProductImageFiles([file], Math.max(images.length - 1, 0));
    if (!validation.success) {
      setError(productImageErrorMessage(validation.error));
      return;
    }

    releaseOwnedProductImageUrl(target, ownedUrlsRef.current);
    const replacement = createImage(file, target.role, target.id);
    const nextImages = images.map((image) => image.id === target.id ? replacement : image);
    imagesRef.current = nextImages;
    onChange(nextImages);
    setBrokenIds((current) => {
      const next = new Set(current);
      next.delete(target.id);
      return next;
    });
    setError(null);
    void persistLocalFile(file, replacement);
  }

  function handleRemove(id: string) {
    const target = images.find((image) => image.id === id);
    if (target) releaseOwnedProductImageUrl(target, ownedUrlsRef.current);
    const nextImages = removeProductImage(images, id);
    imagesRef.current = nextImages;
    onChange(nextImages);
    if (lightboxImage?.id === id) setLightboxImage(null);
    setError(target?.role === "main-product" && nextImages.length > 0 ? "主产品已删除，请从补充参考中选择新的主产品，或重新上传。" : null);
  }

  function handleSetMain(id: string) {
    const nextImages = setMainProductImage(images, id);
    imagesRef.current = nextImages;
    onChange(nextImages);
  }

  const mainImage = images.find((image) => image.role === "main-product");
  const referenceImages = images.filter((image) => image.role === "reference");
  const logoImages = images.filter((image) => image.role === "logo");

  function renderAsset(image: ProductImage, variant: "primary" | "supplemental") {
    const source = resolveProductImageUrl(image);
    const isBroken = brokenIds.has(image.id) || !source;
    return (
      <article key={image.id} className={`product-asset product-asset--${variant}`} data-role={image.role}>
        <button type="button" className="product-asset__preview" onClick={() => !isBroken && setLightboxImage(image)} aria-label={`查看 ${image.name}`} disabled={isBroken}>
          {isBroken ? (
            <span className="product-asset__broken"><span className="product-assets__glyph" aria-hidden="true" />图片无法显示</span>
          ) : (
            <AdaptiveMediaFrame
              aspectRatio="1:1"
              stage="product"
              src={source}
              mediaType="image"
              fit="contain"
              showBlurredBackdrop={false}
              alt={image.name}
              onError={() => setBrokenIds((current) => new Set(current).add(image.id))}
            />
          )}
        </button>
        <div className="product-asset__meta">
          <span className="product-asset__role">{roleLabels[image.role]}</span>
          <strong title={image.name}>{image.name}</strong>
          <small>{formatFileSize(image.size)}{uploadingIds.has(image.id) ? " · 保存中" : ""}</small>
        </div>
        <div className="product-asset__actions">
          <button type="button" onClick={() => setLightboxImage(image)} disabled={isBroken} aria-label={`查看 ${image.name}`}>查看</button>
          <button type="button" onClick={() => { replaceTargetRef.current = image.id; replaceInputRef.current?.click(); }} disabled={disabled} aria-label={`替换 ${image.name}`}>替换</button>
          {image.role === "reference" ? <button type="button" onClick={() => handleSetMain(image.id)} disabled={disabled} aria-label={`将 ${image.name} 设为主产品`}>设为主产品</button> : null}
          <button type="button" onClick={() => handleRemove(image.id)} disabled={disabled} aria-label={`删除 ${image.name}`}>删除</button>
        </div>
      </article>
    );
  }

  return (
    <section className="product-assets" aria-labelledby="product-assets-title">
      <div className="product-assets__header">
        <div>
          <h3 id="product-assets-title">产品图</h3>
        </div>
        {images.length < 3 ? (
          <button type="button" onClick={() => openAddPicker(mainImage ? "reference" : "main-product")} disabled={disabled} aria-label={mainImage ? "添加补充参考" : "添加主产品"}>添加</button>
        ) : null}
      </div>
      <p className="product-assets__help">已有一张清晰主产品图即可生成。补充其他真实角度仅用于提高一致性。</p>

      <div className="product-assets__primary" aria-label="主产品">
      {mainImage ? renderAsset(mainImage, "primary") : (
        <button
          type="button"
          className="product-assets__empty product-assets__empty--primary"
          disabled={disabled}
          onClick={() => openAddPicker("main-product")}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); if (!disabled) { addRoleRef.current = "main-product"; handleFiles(event.dataTransfer.files); } }}
        >
          <span className="product-assets__glyph" aria-hidden="true" />
          <span><strong>添加主产品</strong><small>用于锁定商品外观，仅接受真实上传图片</small></span>
          <em>选择图片</em>
        </button>
      )}
      </div>

      <div className="product-assets__supplemental">
        <div className="product-assets__section-heading"><strong>补充参考</strong><span>可选，最多 2 张真实角度</span></div>
        {referenceImages.length > 0 ? (
          <div className="product-assets__reference-grid">{referenceImages.map((image) => renderAsset(image, "supplemental"))}</div>
        ) : (
          <button type="button" className="product-assets__reference-empty" onClick={() => openAddPicker(mainImage ? "reference" : "main-product")} disabled={disabled || images.length >= 3}>
            <span aria-hidden="true">+</span>{mainImage ? "添加真实角度" : "请先添加主产品"}
          </button>
        )}
      </div>

      {logoImages.length > 0 ? <div className="product-assets__legacy"><div className="product-assets__section-heading"><strong>品牌标识</strong><span>兼容已有素材</span></div>{logoImages.map((image) => renderAsset(image, "supplemental"))}</div> : null}

      <input ref={addInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple={addRoleRef.current === "reference"} hidden onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ""; }} />
      <input ref={replaceInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) handleReplace(file); event.target.value = ""; }} />
      {error ? <p className="product-assets__error" role="alert">{error}</p> : null}

      {lightboxImage ? (
        <dialog open className="product-lightbox" aria-label={`查看 ${lightboxImage.name}`}>
          <button type="button" className="product-lightbox__backdrop" onClick={() => setLightboxImage(null)} aria-label="关闭预览" />
          <div className="product-lightbox__content">
            <header><div><strong>{lightboxImage.name}</strong><span>{roleLabels[lightboxImage.role]} · {formatFileSize(lightboxImage.size)}</span></div><button type="button" onClick={() => setLightboxImage(null)} aria-label="关闭"><span aria-hidden="true">×</span></button></header>
            <img src={resolveProductImageUrl(lightboxImage)} alt={lightboxImage.name} />
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
