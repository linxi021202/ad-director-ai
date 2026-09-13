"use client";

import { ProductImageUploader } from "@/components/ProductImageUploader";
import type { ProductBrief, ProductImage } from "@/lib/schemas/project";

type ProductInputFormProps = {
  product: ProductBrief;
  projectId?: string;
  onProductImagesChange?: (images: ProductImage[]) => void;
};

export function ProductInputForm({ product, projectId, onProductImagesChange }: ProductInputFormProps) {
  return (
    <form className="product-input-form">
      <h2>广告需求</h2>
      <section className="form-section">
        <header className="form-section__header"><h3>基础信息</h3></header>
        <div className="form-section__fields">
          <Field label="商品名称" value={product.productName} />
          <Field label="品类" value={product.category} />
          <Field label="目标用户" value={product.targetAudience} />
        </div>
      </section>
      <section className="form-section">
        <header className="form-section__header"><h3>广告设置</h3></header>
        <div className="form-section__fields">
          <div className="product-input-form__settings">
            <Field label="平台" value={product.platform} />
            <Field label="画幅" value={product.aspectRatio} />
            <Field label="时长" value={`${product.durationSec} 秒`} />
          </div>
          <Field label="风格" value={product.style} />
          <label><span>商品卖点</span><textarea readOnly rows={4} value={product.sellingPoints.join("\n")} /></label>
        </div>
      </section>
      <ProductImageUploader images={product.productImages ?? []} projectId={projectId} onChange={(images) => onProductImagesChange?.(images)} />
    </form>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <label><span>{label}</span><input readOnly value={value} /></label>;
}
