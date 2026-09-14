"use client";

import { useEffect, useRef, useState } from "react";
import { AdaptiveMediaFrame } from "@/components/media/AdaptiveMediaFrame";
import {
  createProductImageMetadata,
  detectLikelyMultiViewProductImage,
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
  "main-product": "主要图片",
  logo: "品牌标识",
  reference: "其他角度"
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

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validation = validateProductImageFiles(files, images.length);
    if (!validation.success) {
      setError(productImageErrorMessage(validation.error));
      return;
    }

    const hasMain = images.some((image) => image.role === "main-product");
    const warnings = await Promise.all(files.map(detectLikelyMultiViewProductImage));
    const created = files.map((file, index) => ({
      ...createImage(
        file,
        !hasMain && index === 0 ? "main-product" : "reference",
        `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
      ),
      ...(warnings[index] ? { multiViewWarning: true } : {})
    }));
    const nextImages = [...images, ...created];
    imagesRef.current = nextImages;
    onChange(nextImages);
    setError(null);
    created.forEach((image, index) => void persistLocalFile(files[index]!, image));
  }

  async function handleReplace(file: File) {
    const targetId = replaceTargetRef.current;
    const target = images.find((image) => image.id === targetId);
    if (!target) return;
    const validation = validateProductImageFiles([file], Math.max(images.length - 1, 0));
    if (!validation.success) {
      setError(productImageErrorMessage(validation.error));
      return;
    }

    releaseOwnedProductImageUrl(target, ownedUrlsRef.current);
    const multiViewWarning = await detectLikelyMultiViewProductImage(file);
    const replacement = { ...createImage(file, target.role, target.id), ...(multiViewWarning ? { multiViewWarning: true } : {}) };
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
    setError(null);
  }

  function handleSetMain(id: string) {
    const nextImages = setMainProductImage(images, id);
    imagesRef.current = nextImages;
    onChange(nextImages);
  }

  const mainImage = images.find((image) => image.role === "main-product");

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
          {image.multiViewWarning ? <small className="product-asset__warning">这张图片包含多个产品视图。为了提高生成稳定性，建议上传单个产品的独立图片。</small> : null}
        </div>
        <div className="product-asset__actions">
          <button type="button" onClick={() => setLightboxImage(image)} disabled={isBroken} aria-label={`查看 ${image.name}`}>查看</button>
          <button type="button" onClick={() => { replaceTargetRef.current = image.id; replaceInputRef.current?.click(); }} disabled={disabled} aria-label={`替换 ${image.name}`}>替换</button>
          {image.role !== "main-product" && image.role !== "logo" ? <button type="button" onClick={() => handleSetMain(image.id)} disabled={disabled} aria-label={`将 ${image.name} 设为主要图片`}>设为主要图片</button> : null}
          <button type="button" onClick={() => handleRemove(image.id)} disabled={disabled} aria-label={`删除 ${image.name}`}>删除</button>
        </div>
      </article>
    );
  }

  return (
    <section className="product-assets" aria-labelledby="product-assets-title">
      <div className="product-assets__header">
        <div>
          <h3 id="product-assets-title">产品图片</h3><span>{images.length} / 3</span>
        </div>
        <button type="button" onClick={() => images.length >= 3 ? setError("最多可上传 3 张产品图片；如需添加，请先删除一张现有图片。") : openAddPicker(mainImage ? "reference" : "main-product")} disabled={disabled} aria-label="添加产品图片">{images.length >= 3 ? "已达到 3 张上限" : "添加图片"}</button>
      </div>
      <p className="product-assets__help">最多上传 3 张真实产品图片。一张清晰图片即可开始；第一张会自动设为主要图片，你也可以随时更换。</p>

      {images.length ? <div className="product-assets__unified-grid" aria-label="产品图片列表">{images.map((image) => renderAsset(image, image.role === "main-product" ? "primary" : "supplemental"))}</div> : (
        <button
          type="button"
          className="product-assets__empty product-assets__empty--primary"
          disabled={disabled}
          onClick={() => openAddPicker("main-product")}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); if (!disabled) { addRoleRef.current = "main-product"; void handleFiles(event.dataTransfer.files); } }}
        >
          <span className="product-assets__glyph" aria-hidden="true" />
          <span><strong>添加产品图片</strong><small>上传一张清晰、独立的真实产品图片即可</small></span>
          <em>选择图片</em>
        </button>
      )}

      <input ref={addInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.target.value = ""; }} />
      <input ref={replaceInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleReplace(file); event.target.value = ""; }} />
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
