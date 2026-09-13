"use client";

import { useState } from "react";
import type { GenerationProject, StoryboardShot } from "@/lib/schemas/project";

export function StoryboardTimeline({ project }: { project: GenerationProject }) {
  const [detailShot, setDetailShot] = useState<StoryboardShot | null>(null);
  const promptPackage = detailShot ? project.shotPromptPackages?.find((item) => item.shotId === detailShot.id) : undefined;
  return <>
    <section className="storyboard-text-timeline" aria-label="文字分镜时间线">
      {project.shots.map((shot) => <article id={`storyboard-shot-${shot.id}`} key={shot.id}>
        <header><strong>镜头 {String(shot.index).padStart(2, "0")}</strong><span>{shot.durationSec} 秒</span></header>
        <h2>{shot.title ?? shot.narrativeProgression?.newInformation ?? shot.goal}</h2>
        <p>{shot.visualSummary ?? shot.visualDescription}</p>
        <dl><div><dt>镜头作用</dt><dd>{shot.commercialPurpose ?? shot.narrativeProgression?.resultingState ?? shot.goal}</dd></div><div><dt>动作节奏</dt><dd>{shot.microBeats?.length ?? 0} 个</dd></div><div><dt>旁白</dt><dd>{project.narrationPlan?.beats.find((beat) => beat.shotId === shot.id)?.text ?? "无旁白"}</dd></div></dl>
        <button type="button" className="text-action-v3" onClick={() => setDetailShot(shot)}>查看镜头详情</button>
      </article>)}
    </section>
    {detailShot ? <div className="storyboard-detail-backdrop" role="presentation" onMouseDown={() => setDetailShot(null)}>
      <section className="storyboard-detail-sheet" role="dialog" aria-modal="true" aria-label={`镜头 ${detailShot.index} 详情`} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>镜头 {String(detailShot.index).padStart(2, "0")} · {detailShot.durationSec} 秒</span><h2>{detailShot.title ?? detailShot.goal}</h2></div><button type="button" aria-label="关闭镜头详情" onClick={() => setDetailShot(null)}>×</button></header>
        <DetailSection title="导演意图" rows={[
          ["叙事作用", detailShot.narrativePurpose ?? detailShot.goal], ["商业作用", detailShot.commercialPurpose ?? detailShot.goal],
          ["前序状态", detailShot.previousState ?? detailShot.narrativeProgression?.previousState], ["新增信息", detailShot.newInformation ?? detailShot.narrativeProgression?.newInformation],
          ["结束状态", detailShot.resultingState ?? detailShot.narrativeProgression?.resultingState], ["画面说明", detailShot.visualSummary ?? detailShot.visualDescription],
          ["构图意图", detailShot.compositionIntent], ["情绪意图", detailShot.emotionalIntent], ["产品呈现", detailShot.productVisibilityIntent]
        ]} />
        <section className="storyboard-detail-section"><h3>动作节奏</h3>{detailShot.microBeats?.map((beat) => <article className="microbeat-detail" key={beat.id}><strong>{beat.startSec.toFixed(1)}s–{beat.endSec.toFixed(1)}s</strong><p>{beat.characterAction ?? beat.action}</p><small>{[beat.handAction, beat.gazeAction, beat.productAction, beat.cameraAction, beat.environmentAction, beat.expressionChange].filter(Boolean).join("；")}</small></article>)}</section>
        {promptPackage ? <section className="storyboard-detail-section"><h3>完整生成提示词</h3>
          <PromptBlock title="中文图片提示词" text={promptPackage.framePrompts.map((frame) => frame.imagePromptCn).join("\n\n")} />
          <PromptBlock title="英文图片提示词" text={promptPackage.framePrompts.map((frame) => frame.imagePromptEn).join("\n\n")} />
          <PromptBlock title="中文视频提示词" text={promptPackage.videoPromptCn} />
          <PromptBlock title="英文视频提示词" text={promptPackage.videoPromptEn} />
          <PromptBlock title="限制条件" text={[promptPackage.negativePromptCn, promptPackage.negativePromptEn, ...promptPackage.continuityContext.immutableElements].join("\n")} />
        </section> : <section className="storyboard-detail-section"><h3>完整生成提示词</h3><p>确认文字分镜后，将为这个镜头单独扩写图片和视频提示词。</p></section>}
      </section>
    </div> : null}
  </>;
}

function DetailSection({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  return <section className="storyboard-detail-section"><h3>{title}</h3><dl>{rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return <article className="full-prompt-block"><header><strong>{title}</strong><button type="button" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? "已复制" : "复制"}</button></header><pre>{text}</pre></article>;
}
