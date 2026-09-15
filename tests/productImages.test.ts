import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildProductAssetCollection,
  createProductImageMetadata,
  getProjectProductAssets,
  normalizeProductAssetState,
  releaseOwnedProductImageUrl,
  removeProductImage,
  resolveProductImageUrl,
  setMainProductImage,
  validateProductImageFiles
} from "../lib/productImages";
import { productBriefSchema } from "../lib/schemas/project";
import { buildStrategyPrompt } from "../lib/prompts";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildQwenImageContent } from "../lib/image/qwenImageClient";
import { selectPrimaryProductImage } from "../lib/image/productReference";

describe("product image input support", () => {
  it("explains and exposes main versus supplemental product image roles", () => {
    const uploader = readFileSync("components/ProductImageUploader.tsx", "utf8");
    const anchors = readFileSync("components/VisualAnchorsCanvas.tsx", "utf8");
    for (const label of ["主产品图", "补充参考图", "锁定产品身份", "提高生成一致性"]) {
      expect(`${uploader}\n${anchors}`).toContain(label);
    }
    expect(anchors).toContain("设为主产品图");
    expect(anchors).toContain("删除");
    expect(anchors).toContain("查看原图");
    expect(anchors).toContain("不会单独替代主图");
  });

  it("creates preview metadata for one uploaded image", () => {
    const file = { name: "coffee.png", type: "image/png", size: 1200 };
    const validation = validateProductImageFiles([file], 0);
    const image = createProductImageMetadata(file, "blob:preview", "main-product", "img-1");

    expect(validation.success).toBe(true);
    expect(image.previewUrl).toBe("blob:preview");
    expect(image.role).toBe("main-product");
  });

  it("removes image metadata after delete", () => {
    const image = createProductImageMetadata(
      { name: "coffee.webp", type: "image/webp", size: 1000 },
      "blob:preview",
      "reference",
      "img-1"
    );

    expect(removeProductImage([image], "img-1")).toEqual([]);
  });

  it("promotes the next product image after the main product is deleted", () => {
    const main = createProductImageMetadata({ name: "main.png", type: "image/png", size: 1000 }, "blob:main", "main-product", "main");
    const reference = createProductImageMetadata({ name: "angle.png", type: "image/png", size: 1000 }, "blob:angle", "reference", "angle");

    expect(removeProductImage([main, reference], "main")).toEqual([{ ...reference, role: "main-product" }]);
  });

  it("returns an error for more than three images", () => {
    const files = [
      { name: "1.png", type: "image/png", size: 100 },
      { name: "2.png", type: "image/png", size: 100 },
      { name: "3.png", type: "image/png", size: 100 },
      { name: "4.png", type: "image/png", size: 100 }
    ];

    expect(validateProductImageFiles(files, 0)).toEqual({ success: false, error: "too-many" });
  });

  it("returns an error for non-image types", () => {
    expect(validateProductImageFiles([{ name: "brief.pdf", type: "application/pdf", size: 100 }], 0)).toEqual({
      success: false,
      error: "unsupported-type"
    });
  });

  it("returns an error for files over 5MB", () => {
    expect(validateProductImageFiles([{ name: "huge.jpg", type: "image/jpeg", size: 6 * 1024 * 1024 }], 0)).toEqual({
      success: false,
      error: "too-large"
    });
  });

  it("validates ProductBrief with up to three product images", () => {
    const parsed = productBriefSchema.safeParse({
      ...coldBrewDemo.brief,
      productImages: [
        createProductImageMetadata({ name: "coffee.jpg", type: "image/jpeg", size: 1000 }, "blob:preview", "main-product", "img-1")
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("maps the legacy main role to main-product", () => {
    const parsed = productBriefSchema.parse({
      ...coldBrewDemo.brief,
      productImages: [{
        id: "legacy-main",
        name: "legacy.png",
        type: "image/png",
        size: 1000,
        previewUrl: "blob:legacy",
        role: "main"
      }]
    });

    expect(parsed.productImages?.[0]?.role).toBe("main-product");
  });

  it("does not put image file content or previewUrl into DeepSeek prompt", () => {
    const prompt = buildStrategyPrompt({
      ...coldBrewDemo.brief,
      productImages: [
        {
          id: "img-1",
          name: "secret-packaging.png",
          type: "image/png",
          size: 1000,
          previewUrl: "blob:local-preview-url",
          role: "main-product"
        }
      ]
    });

    expect(prompt).toContain("User uploaded product reference images");
    expect(prompt).not.toContain("blob:local-preview-url");
    expect(prompt).not.toContain("secret-packaging.png");
    expect(prompt.toLowerCase()).toContain("do not request base64");
  });

  it("resolves stable local image URLs before temporary previews", () => {
    const image = {
      ...createProductImageMetadata({ name: "coffee.png", type: "image/png", size: 1000 }, "blob:preview", "reference", "img-1"),
      localUrl: "/uploads/project/img-1.png",
      remoteUrl: "https://example.com/remote.png",
      url: "/fallback.png"
    };
    expect(resolveProductImageUrl(image)).toBe("/uploads/project/img-1.png");
    expect(resolveProductImageUrl({ ...image, localUrl: undefined })).toBe("blob:preview");
  });

  it("releases an owned object URL when an image is replaced or removed", () => {
    const image = createProductImageMetadata({ name: "coffee.png", type: "image/png", size: 1000 }, "blob:old", "reference", "img-1");
    const ownedUrls = new Set(["blob:old"]);
    const revoked: string[] = [];
    expect(releaseOwnedProductImageUrl(image, ownedUrls, (url) => revoked.push(url))).toBe(true);
    expect(revoked).toEqual(["blob:old"]);
    expect(ownedUrls.size).toBe(0);
  });

  it("keeps exactly one main product image when the role changes", () => {
    const first = createProductImageMetadata({ name: "one.png", type: "image/png", size: 1000 }, "blob:one", "main-product", "one");
    const second = createProductImageMetadata({ name: "two.png", type: "image/png", size: 1000 }, "blob:two", "reference", "two");
    const next = setMainProductImage([first, second], "two");
    expect(next.find((image) => image.id === "one")?.role).toBe("reference");
    expect(next.find((image) => image.id === "two")?.role).toBe("main-product");
  });

  it("selects the main product image as the generation reference", () => {
    const images = [
      createProductImageMetadata({ name: "reference.png", type: "image/png", size: 1000 }, "blob:reference", "reference", "ref"),
      createProductImageMetadata({ name: "main.png", type: "image/png", size: 1000 }, "blob:main", "main-product", "main")
    ];

    expect(selectPrimaryProductImage(images)?.id).toBe("main");
  });

  it("canonicalizes one uploaded product across all product asset fields", () => {
    const assetId = "10000000-0000-4000-8000-000000000001";
    const image = {
      ...createProductImageMetadata({ name: "one.png", type: "image/png", size: 1000 }, "/api/assets/one", "reference", "one"),
      assetId
    };
    const brief = normalizeProductAssetState({ ...coldBrewDemo.brief, productImages: [image] });

    expect(brief.productAssetIds).toEqual([assetId]);
    expect(brief.primaryProductAssetId).toBe(assetId);
    expect(brief.productImages?.[0]?.role).toBe("main-product");
    expect(getProjectProductAssets(brief).primaryAsset?.id).toBe("one");
  });

  it("keeps A, B and C ordered while every stage resolves B as the primary product", () => {
    const assetIds = [
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
      "20000000-0000-4000-8000-000000000003"
    ];
    const images = assetIds.map((assetId, index) => ({
      ...createProductImageMetadata({ name: `${index}.png`, type: "image/png", size: 1000 }, `/api/assets/${index}`, index === 1 ? "main-product" as const : "reference" as const, `image-${index}`),
      assetId
    }));
    const collection = buildProductAssetCollection(images);
    const brief = normalizeProductAssetState({
      ...coldBrewDemo.brief,
      productImages: images,
      productAssetIds: ["30000000-0000-4000-8000-000000000099", ...assetIds],
      primaryProductAssetId: collection.primaryProductAssetId
    });
    const selection = getProjectProductAssets(brief);

    expect(selection.assetIds).toEqual(assetIds);
    expect(selection.primaryAssetId).toBe(assetIds[1]);
    expect(selection.primaryAsset?.id).toBe("image-1");
    expect(brief.productImages?.filter((image) => image.role === "main-product")).toHaveLength(1);
  });

  it("builds a multimodal Qwen request with the real product reference before the shot prompt", () => {
    const content = buildQwenImageContent({
      prompt: "Create an office advertising keyframe.",
      referenceImage: "data:image/png;base64,cHJvZHVjdA=="
    });

    expect(content).toEqual([
      { image: "data:image/png;base64,cHJvZHVjdA==" },
      { text: "Create an office advertising keyframe." }
    ]);
  });

  it("keeps product and previous-shot references ordered before one prompt", () => {
    const content = buildQwenImageContent({
      prompt: "Create a distinct next shot while preserving identity.",
      referenceImages: ["data:image/png;base64,cHJvZHVjdA==", "data:image/png;base64,cHJldmlvdXM="]
    });

    expect(content).toEqual([
      { image: "data:image/png;base64,cHJvZHVjdA==" },
      { image: "data:image/png;base64,cHJldmlvdXM=" },
      { text: "Create a distinct next shot while preserving identity." }
    ]);
  });
});
