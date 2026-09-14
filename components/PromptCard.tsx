import React from "react";
type PromptCardProps = {
  id: "original" | "optimized";
  title: string;
  body: string;
  copied: boolean;
  expanded: boolean;
  onCopy: () => void;
  onToggle: () => void;
};

export function PromptCard({ id, title, body, copied, expanded, onCopy, onToggle }: PromptCardProps) {
  return (
    <article className={`prompt-card${expanded ? " is-expanded" : ""}`} data-prompt={id}>
      <header className="prompt-card__header">
        <h3>{title}</h3>
        <button type="button" onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
      </header>
      <div className="prompt-card__body"><p>{body}</p></div>
      <button type="button" className="prompt-card__toggle" aria-expanded={expanded} onClick={onToggle}>
        {expanded ? "收起生成提示词" : "展开完整生成提示词"}
      </button>
    </article>
  );
}
