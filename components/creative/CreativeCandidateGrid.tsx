"use client";

import { useState } from "react";
import type { CreativeCandidateSet, CreativeDirection } from "@/lib/schemas/project";

type Props = {
  candidateSet?: CreativeCandidateSet;
  busy: boolean;
  onGenerate: () => void;
  onSelect: (candidateId: string) => void;
  onConfirm: (candidateId: string) => void;
};

export function CreativeCandidateGrid({ candidateSet, busy, onGenerate, onSelect, onConfirm }: Props) {
  const [detail, setDetail] = useState<CreativeDirection | null>(null);
  if (busy && !candidateSet) return <div className="creative-loading" aria-live="polite">{[1, 2, 3].map((item) => <div key={item}><i /><i /><i /><i /></div>)}</div>;
  if (!candidateSet) return <div className="creative-empty-state"><strong>还没有创意方向</strong><p>生成后会得到三套机制、故事和高光时刻都不同的完整方案。</p><button type="button" className="button-primary-v3" disabled={busy} onClick={onGenerate}>{busy ? "生成中" : "生成 3 套创意方向"}</button></div>;

  const selectedId = candidateSet.selectedCandidateId ?? candidateSet.recommendedCandidateId;
  return <>
    <div className="creative-set-toolbar"><div><strong>第 {candidateSet.version} 组方案</strong><span>共 3 套可用创意</span></div><button type="button" className="button-secondary-v3" disabled={busy} onClick={onGenerate}>{busy ? "重新生成中" : "重新生成一组"}</button></div>
    <div className="creative-candidate-grid">
      {candidateSet.candidates.map((candidate) => {
        const selected = selectedId === candidate.id;
        return <article className={`creative-candidate${selected ? " is-current" : ""}`} key={candidate.id}>
          <header><span>方案 {candidateSet.candidates.indexOf(candidate) + 1}</span>{candidate.id === candidateSet.recommendedCandidateId ? <strong>推荐</strong> : null}</header>
          <h2>{candidate.title}</h2><p>{candidate.oneLineIdea}</p>
          <dl><div><dt>创意机制</dt><dd>{candidate.creativeMechanism}</dd></div><div><dt>故事走向</dt><dd>{candidate.storyArc}</dd></div><div><dt>产品高光</dt><dd>{candidate.heroMoment}</dd></div></dl>
          <footer><button type="button" className="text-action-v3" onClick={() => setDetail(candidate)}>查看完整方案</button><button type="button" className={selected ? "is-selected" : ""} disabled={busy || selected} onClick={() => onSelect(candidate.id)}>{selected ? "已选择" : "选择方案"}</button></footer>
        </article>;
      })}
    </div>
    <div className="creative-confirm-bar"><span>{selectedId === candidateSet.recommendedCandidateId ? "已选择系统推荐方案" : "已选择自定义方案"}</span><button type="button" className="button-primary-v3" disabled={busy} onClick={() => onConfirm(selectedId)}>{busy ? "处理中" : "确认创意并继续"}</button></div>
    {detail ? <div className="creative-detail-backdrop" role="presentation" onMouseDown={() => setDetail(null)}><section className="creative-detail-sheet" role="dialog" aria-modal="true" aria-label={`${detail.title}完整方案`} onMouseDown={(event) => event.stopPropagation()}><header><div><span>完整创意方案</span><h2>{detail.title}</h2></div><button type="button" aria-label="关闭" onClick={() => setDetail(null)}>×</button></header><dl>{detailRows(detail).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section></div> : null}
  </>;
}

function detailRows(direction: CreativeDirection): Array<[string, string]> {
  return [
    ["一句话创意", direction.oneLineIdea], ["用户张力", direction.audienceTension], ["核心洞察", direction.coreInsight],
    ["核心创意", direction.bigIdea], ["创意机制", direction.creativeMechanism], ["视觉隐喻", direction.visualMetaphor],
    ["故事走向", direction.storyArc], ["开场钩子", direction.openingHook], ["产品入场", direction.productEntrance], ["视觉钩子", direction.visualHook], ["产品角色", direction.productRole],
    ["情绪转折", direction.emotionalTurn], ["产品高光", direction.heroMoment], ["结尾构想", direction.endingIdea],
    ["视觉风格", direction.visualStyle], ["镜头语言", direction.cameraLanguage], ["节奏策略", direction.pacingStrategy],
    ["有效原因", direction.whyItWorks], ["相比原始需求新增内容", direction.differenceFromBrief], ["执行风险", direction.executionRisk], ["连续性策略", direction.continuityStrategy]
  ];
}
