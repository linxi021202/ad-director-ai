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
  reference: "参考图"
};

export function ProductImageUploader({ images, onChange, onPersistedVersion, projectId, disabled = false }: ProductImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  const [lightboxImage, setLightboxImage] = useState<ProductImage | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
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

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validation = validateProductImageFiles(files, images.length);
    if (!validation.success) {
      setError(productImageErrorMessage(validation.error));
      return;
    }

    const created = files.map((file, index) => createImage(
      file,
      images.length === 0 && index === 0 ? "main-product" : "reference",
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
    setError(null);
  }

  function handleSetMain(id: string) {
    const nextImages = setMainProductImage(images, id);
    imagesRef.current = nextImages;
    onChange(nextImages);
  }

  return (
    <section className="product-assets" aria-labelledby="product-assets-title">
      <div className="product-assets__header">
        <div>
          <h3 id="product-assets-title">产品图</h3>
          <p>保持包装一致，并用于结尾行动画面。图片不会传给文本模型。</p>
        </div>
        {images.length > 0 && images.length < 3 ? (
          <button type="button" onClick={() => addInputRef.current?.click()} disabled={disabled}>添加</button>
        ) : null}
      </div>

      {images.length === 0 ? (
        <button
          type="button"
          className="product-assets__empty"
          disabled={disabled}
          onClick={() => addInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); if (!disabled) handleFiles(event.dataTransfer.files); }}
        >
          <span className="product-assets__glyph" aria-hidden="true" />
          <span><strong>上传产品图</strong><small>PNG / JPG / WebP，最多 3 张，单张不超过 5MB</small></span>
          <em>选择图片</em>
        </button>
      ) : (
        <div className="product-assets__grid">
          {images.map((image) => {
            const source = resolveProductImageUrl(image);
            const isBroken = brokenIds.has(image.id) || !source;
            return (
              <article key={image.id} className="product-asset" data-role={image.role}>
                <button type="button" className="product-asset__preview" onClick={() => !isBroken && setLightboxImage(image)} aria-label={`查看 ${image.name}`}>
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
                  <span className="product-asset__role">{roleLabels[image.role]}</span>
                  {uploadingIds.has(image.id) ? <span className="product-asset__saving">保存中</span> : null}
                </button>
                <div className="product-asset__meta"><strong title={image.name}>{image.name}</strong><small>{formatFileSize(image.size)}</small></div>
                <div className="product-asset__actions">
                  <button type="button" onClick={() => setLightboxImage(image)} disabled={isBroken}>查看</button>
                  <button type="button" onClick={() => { replaceTargetRef.current = image.id; replaceInputRef.current?.click(); }} disabled={disabled}>替换</button>
                  {image.role !== "main-product" ? <button type="button" onClick={() => handleSetMain(image.id)} disabled={disabled}>设为主图</button> : null}
                  <button type="button" onClick={() => handleRemove(image.id)} disabled={disabled} aria-label={`删除 ${image.name}`}>删除</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <input ref={addInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { if (event.target.files) handleFiles(event.target.files); event.target.value = ""; }} />
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
