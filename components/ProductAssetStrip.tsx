"use client";

import React, { useEffect, useRef, useState } from "react";
import { AdaptiveMediaFrame } from "./media/AdaptiveMediaFrame";
import { createProductImageMetadata, productImageErrorMessage, releaseOwnedProductImageUrl, removeProductImage, resolveProductImageUrl, setMainProductImage, validateProductImageFiles } from "../lib/productImages";
import type { ProductImage } from "../lib/schemas/project";

type Props = { projectId: string; images: ProductImage[]; onChange: (images: ProductImage[]) => void };
type UploadResponse = { success: boolean; data?: { localUrl: string } | null; error?: string };
export function moveProductImage(images: ProductImage[], id: string, direction: -1 | 1) { const index=images.findIndex((image)=>image.id===id); const target=index+direction; if(index<0||target<0||target>=images.length) return images; const next=[...images]; [next[index],next[target]]=[next[target]!,next[index]!]; return next; }

const roleLabel: Record<ProductImage["role"], string> = { "main-product": "主产品", logo: "Logo", reference: "参考图" };

export function ProductAssetStrip({ projectId, images, onChange }: Props) {
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const ownedUrls = useRef(new Set<string>());
  const imagesRef = useRef(images);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(new Set<string>());
  const [lightbox, setLightbox] = useState<ProductImage | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => { for (const image of imagesRef.current) releaseOwnedProductImageUrl(image, ownedUrls.current); }, []);

  function commit(next: ProductImage[]) { imagesRef.current = next; onChange(next); }
  function makeImage(file: File, role: ProductImage["role"], id: string) { const url = URL.createObjectURL(file); ownedUrls.current.add(url); return createProductImageMetadata(file, url, role, id); }
  async function persist(file: File, image: ProductImage) {
    setUploading((current) => new Set(current).add(image.id));
    try {
      const body = new FormData(); body.append("file", file); body.append("projectId", projectId); body.append("assetId", image.id);
      const response = await fetch("/api/upload-product-image", { method: "POST", body });
      const payload = await response.json() as UploadResponse;
      if (!response.ok || !payload.success || !payload.data?.localUrl) throw new Error(payload.error || "本地素材保存失败");
      const current = imagesRef.current.find((item) => item.id === image.id); if (!current) return;
      releaseOwnedProductImageUrl(current, ownedUrls.current);
      commit(imagesRef.current.map((item) => item.id === image.id ? { ...item, localUrl: payload.data!.localUrl, previewUrl: undefined } : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "本地素材保存失败"); }
    finally { setUploading((current) => { const next = new Set(current); next.delete(image.id); return next; }); }
  }
  function addFiles(list: FileList | File[]) {
    const files = Array.from(list); const validation = validateProductImageFiles(files, images.length);
    if (!validation.success) { setError(productImageErrorMessage(validation.error)); return; }
    const created = files.map((file, index) => makeImage(file, images.length === 0 && index === 0 ? "main-product" : "reference", `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`));
    commit([...images, ...created]); setError(null); created.forEach((image, index) => void persist(files[index]!, image));
  }
  function replace(file: File) {
    const target = images.find((image) => image.id === replaceId.current); if (!target) return;
    const validation = validateProductImageFiles([file], images.length - 1); if (!validation.success) { setError(productImageErrorMessage(validation.error)); return; }
    releaseOwnedProductImageUrl(target, ownedUrls.current); const nextImage = makeImage(file, target.role, target.id);
    commit(images.map((image) => image.id === target.id ? nextImage : image)); setMenuId(null); void persist(file, nextImage);
  }
  function remove(id: string) { const target = images.find((item) => item.id === id); if (target) releaseOwnedProductImageUrl(target, ownedUrls.current); commit(removeProductImage(images, id)); setMenuId(null); }
  function move(id: string, direction: -1 | 1) { commit(moveProductImage(images, id, direction)); }
  function setRole(id: string, role: ProductImage["role"]) { commit(role === "main-product" ? setMainProductImage(images, id) : images.map((image) => image.id === id ? { ...image, role } : image)); setMenuId(null); }

  return <section className="product-assets">
    <header className="product-assets__header"><div><h3>产品图</h3><span>{images.length} / 3</span></div>{images.length < 3 ? <button type="button" onClick={() => addInput.current?.click()}>继续上传</button> : null}</header>
    <div className="product-assets__grid">
      {images.map((image, index) => { const source = resolveProductImageUrl(image); return <article className={`product-asset-card${image.role === "main-product" ? " is-main" : ""}`} key={image.id}>
        <div className="product-asset-card__media">{source ? <AdaptiveMediaFrame aspectRatio="1:1" stage="product" src={source} mediaType="image" fit="contain" alt={image.name} /> : null}<span>{roleLabel[image.role]}</span>{uploading.has(image.id) ? <em>保存中</em> : null}<button type="button" aria-label={`${image.name} 更多操作`} onClick={() => setMenuId(menuId === image.id ? null : image.id)}>•••</button></div>
        {menuId === image.id ? <div className="product-asset-menu"><button onClick={() => setLightbox(image)}>查看大图</button>{image.role !== "main-product" ? <button onClick={() => setRole(image.id, "main-product")}>设为主产品图</button> : null}<button onClick={() => { replaceId.current = image.id; replaceInput.current?.click(); }}>更换</button><button onClick={() => setRole(image.id, image.role === "logo" ? "reference" : "logo")}>{image.role === "logo" ? "设为参考图" : "设为 Logo"}</button><button disabled={index === 0} onClick={() => move(image.id, -1)}>向左移动</button><button disabled={index === images.length - 1} onClick={() => move(image.id, 1)}>向右移动</button><button onClick={() => remove(image.id)}>删除</button></div> : null}
      </article>; })}
      {Array.from({ length: 3 - images.length }, (_, index) => <button type="button" className="product-asset-empty" key={`empty-${index}`} onClick={() => addInput.current?.click()}><i>+</i><strong>{images.length === 0 && index === 0 ? "添加主产品图" : index === 0 ? "添加 Logo" : "添加参考图"}</strong><small>完整保留原图比例</small></button>)}
    </div>
    <input ref={addInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
    <input ref={replaceInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) replace(file); event.target.value = ""; }} />
    {error ? <p className="product-assets__error" role="alert">{error}</p> : null}
    {lightbox ? <dialog open className="product-media-lightbox"><button type="button" aria-label="关闭大图" onClick={() => setLightbox(null)} /><img src={resolveProductImageUrl(lightbox)} alt={lightbox.name} /></dialog> : null}
  </section>;
}
