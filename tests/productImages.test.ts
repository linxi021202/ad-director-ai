import { describe, expect, it } from "vitest";
import {
  createProductImageMetadata,
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

  it("builds a multimodal Qwen request with the real product reference before the shot prompt", () => {
    const content = buildQwenImageContent({
      prompt: "Create an office advertising keyframe.",
      referenceImage: "data:image/png;base64,cHJvZHVjdA=="
    });

    expect(content).toEqual([
      { image: "data:image/png;base64,cHJvZHVjdA==" },
      { text: "Create an office advertising keyframe." }
    ]);
  });});
