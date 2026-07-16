"use client";

import React, { useEffect, useRef, useState } from "react";
import { AdaptiveMediaFrame } from "./media/AdaptiveMediaFrame";
import { createProductImageMetadata, productImageErrorMessage, releaseOwnedProductImageUrl, removeProductImage, resolveProductImageUrl, validateProductImageFiles } from "../lib/productImages";
import type { ProductImage } from "../lib/schemas/project";

type ProductMediaSectionProps = {
  projectId: string;
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
};

type UploadResponse = { success: boolean; data?: { localUrl: string } | null; error?: string };

export function ProductMediaSection({ projectId, images, onChange }: ProductMediaSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ownedUrlsRef = useRef(new Set<string>());
  const imagesRef = useRef(images);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const primary = images.find((image) => image.role === "main-product") ?? images[0];
  const source = resolveProductImageUrl(primary);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => {
    for (const image of imagesRef.current) releaseOwnedProductImageUrl(image, ownedUrlsRef.current);
  }, []);

  async function handleFile(file: File) {
    const validation = validateProductImageFiles([file], Math.max(images.length - (primary ? 1 : 0), 0));
    if (!validation.success) { setError(productImageErrorMessage(validation.error)); return; }

    const id = primary?.id ?? `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    if (primary) releaseOwnedProductImageUrl(primary, ownedUrlsRef.current);
    const previewUrl = URL.createObjectURL(file);
    ownedUrlsRef.current.add(previewUrl);
    const nextImage = createProductImageMetadata(file, previewUrl, "main-product", id);
    const nextImages = primary ? images.map((image) => image.id === primary.id ? nextImage : image) : [nextImage, ...images];
    imagesRef.current = nextImages;
    onChange(nextImages);
    setError(null);
    setIsUploading(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("projectId", projectId);
      body.append("assetId", id);
      const response = await fetch("/api/upload-product-image", { method: "POST", body });
      const payload = await response.json() as UploadResponse;
      if (!response.ok || !payload.success || !payload.data?.localUrl) throw new Error(payload.error || "本地素材保存失败");
      ownedUrlsRef.current.delete(previewUrl);
      URL.revokeObjectURL(previewUrl);
      const persisted = imagesRef.current.map((image) => image.id === id ? { ...image, localUrl: payload.data!.localUrl, previewUrl: undefined } : image);
      imagesRef.current = persisted;
      onChange(persisted);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "本地素材保存失败");
    } finally {
      setIsUploading(false);
    }
  }

  function removePrimary() {
    if (!primary) return;
    releaseOwnedProductImageUrl(primary, ownedUrlsRef.current);
    const next = removeProductImage(images, primary.id);
    imagesRef.current = next;
    onChange(next);
    setLightboxOpen(false);
    setError(null);
  }

  return (
    <section className="product-media-section">
      <header className="product-media-header">
        <div><strong>产品图</strong>{!source ? <small>保持包装与标识完整</small> : null}</div>
        <button type="button" onClick={() => inputRef.current?.click()}>{source ? "更换产品图" : "上传产品图"}</button>
      </header>
      <div className={`product-media-stage${source ? " has-media" : ""}`}>
        {source ? (
          <>
            <AdaptiveMediaFrame aspectRatio="1:1" stage="product" src={source} mediaType="image" fit="contain" alt={primary?.name ?? "产品图"} />
            <div className="product-media-actions">
              <button type="button" onClick={() => setLightboxOpen(true)}><span className="product-action-icon is-expand" aria-hidden="true" />查看大图</button>
              <button type="button" onClick={() => inputRef.current?.click()}><span className="product-action-icon is-image" aria-hidden="true" />更换</button>
              <button type="button" onClick={removePrimary}><span className="product-action-icon is-trash" aria-hidden="true" />删除</button>
            </div>
          </>
        ) : (
          <button type="button" className="product-media-empty" onClick={() => inputRef.current?.click()} aria-label="上传产品图"><span className="product-empty-icon" aria-hidden="true" /><span>上传</span></button>
        )}
        {isUploading ? <div className="product-media-loading"><i />保存中</div> : null}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }} />
      {error ? <p className="product-media-error" role="alert">{error}</p> : null}
      {lightboxOpen && source ? <dialog open className="product-media-lightbox"><button type="button" aria-label="关闭大图" onClick={() => setLightboxOpen(false)} /><img src={source} alt={primary?.name ?? "产品图大图"} /></dialog> : null}
    </section>
  );
}
