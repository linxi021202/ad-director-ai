"use client";

import React, { useEffect, useRef, useState } from "react";
import type { GenerationProject } from "@/lib/schemas/project";
import { ViewportDrawer } from "@/components/workspace/ViewportDrawer";

export function StoryboardTimeline({ project, selectedShotId, onVisibleShotChange }: { project: GenerationProject; selectedShotId?: string; onVisibleShotChange?: (shotId: string) => void }) {
  const [selectedStoryboardShotId, setSelectedStoryboardShotId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const cards = [...(timelineRef.current?.querySelectorAll<HTMLElement>("article[data-shot-id]") ?? [])];
    if (!cards.length || !onVisibleShotChange || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, IntersectionObserverEntry>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.shotId;
        if (!id) continue;
        if (entry.isIntersecting) visible.set(id, entry);
        else visible.delete(id);
      }
      const first = [...visible.values()].sort((a, b) => Math.abs(a.boundingClientRect.top - 112) - Math.abs(b.boundingClientRect.top - 112))[0];
      const id = first && (first.target as HTMLElement).dataset.shotId;
      if (id) onVisibleShotChange(id);
    }, { rootMargin: "-100px 0px -55% 0px", threshold: 0 });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [project.shots, onVisibleShotChange]);
  const detailShot = project.shots.find((shot) => shot.id === selectedStoryboardShotId);
  return <>
    <section ref={timelineRef} className="storyboard-text-timeline" aria-label="文字分镜时间线">
      {project.shots.map((shot) => <article id={`storyboard-shot-${shot.id}`} data-shot-id={shot.id} className={selectedShotId === shot.id ? "is-current" : undefined} key={shot.id}>
        <header><strong>镜头 {String(shot.index).padStart(2, "0")}</strong><span>{shot.durationSec} 秒</span></header>
        <h2>{shot.title ?? shot.narrativeProgression?.newInformation ?? shot.goal}</h2>
        <p>{shot.visualSummary ?? shot.visualDescription}</p>
        <dl><div><dt>镜头作用</dt><dd>{shot.commercialPurpose ?? shot.narrativeProgression?.resultingState ?? shot.goal}</dd></div><div><dt>动作节奏</dt><dd>{shot.microBeats?.length ?? 0} 个</dd></div><div><dt>旁白</dt><dd>{project.narrationPlan?.beats.find((beat) => beat.shotId === shot.id)?.text ?? "无旁白"}</dd></div></dl>
        <button type="button" className="text-action-v3" onClick={() => setSelectedStoryboardShotId(shot.id)}>查看镜头详情</button>
      </article>)}
    </section>
    <ViewportDrawer open={Boolean(detailShot)} label={`镜头 ${detailShot?.index ?? ""} 详情`} onClose={() => setSelectedStoryboardShotId(null)} className="storyboard-detail-sheet">
      {detailShot ? <>
        <header><div><span>镜头 {String(detailShot.index).padStart(2, "0")} · {detailShot.durationSec} 秒</span><h2>{detailShot.title ?? detailShot.goal}</h2></div><button type="button" aria-label="关闭镜头详情" onClick={() => setSelectedStoryboardShotId(null)}>×</button></header>
        <div className="storyboard-detail-body">
        <DetailSection title="导演意图" rows={[
          ["叙事作用", detailShot.narrativePurpose ?? detailShot.goal], ["商业作用", detailShot.commercialPurpose ?? detailShot.goal],
          ["前序状态", detailShot.previousState ?? detailShot.narrativeProgression?.previousState], ["新增信息", detailShot.newInformation ?? detailShot.narrativeProgression?.newInformation],
          ["结束状态", detailShot.resultingState ?? detailShot.narrativeProgression?.resultingState], ["画面说明", detailShot.visualSummary ?? detailShot.visualDescription],
          ["构图意图", detailShot.compositionIntent], ["情绪意图", detailShot.emotionalIntent], ["产品呈现", detailShot.productVisibilityIntent]
        ]} />
        <DetailSection title="画面与连续性" rows={[
          ["场景", project.sceneVisualSpecs?.find((scene) => scene.id === detailShot.sceneId)?.name ?? detailShot.sceneId],
          ["人物", project.characterVisualSpecs?.filter((character) => detailShot.characterIds?.includes(character.id)).map((character) => `${character.role}：${character.faceDescription}；${character.wardrobe.join("、")}`).join("；") || detailShot.microBeats?.map((beat) => beat.characterAction).filter(Boolean).join("；")],
          ["产品", detailShot.containsProduct ? [project.brief.productName, detailShot.productVisibilityIntent].filter(Boolean).join("；") : undefined],
          ["机位", detailShot.cameraAngle], ["镜头运动", detailShot.cameraMovement],
          ["旁白", project.narrationPlan?.beats.find((beat) => beat.shotId === detailShot.id)?.text],
          ["连续性", detailShot.continuityConstraints?.join("；")], ["注意事项", [...(detailShot.riskNotes ?? []), ...(detailShot.shotDirection ?? [])].join("；")]
        ]} />
        {detailShot.microBeats?.length ? <section className="storyboard-detail-section"><h3>动作节奏</h3>{detailShot.microBeats.map((beat) => <article className="microbeat-detail" key={beat.id}><strong>{beat.startSec.toFixed(1)}s–{beat.endSec.toFixed(1)}s</strong><p>{beat.characterAction ?? beat.action}</p><small>{[beat.handAction, beat.gazeAction, beat.productAction, beat.cameraAction, beat.environmentAction, beat.expressionChange].filter(Boolean).join("；")}</small></article>)}</section> : null}
        {detailShot.frames?.length ? <section className="storyboard-detail-section"><h3>关键帧计划</h3>{detailShot.frames.map((frame) => <article className="microbeat-detail" key={frame.id}><strong>{frame.timestampSec.toFixed(1)} 秒</strong><p>{frame.keyframeMoment?.momentDescription ?? frame.description}</p><small>{frame.keyframeMoment?.continuityFromPreviousFrame}</small></article>)}</section> : null}
        </div>
      </> : null}
    </ViewportDrawer>
  </>;
}

function DetailSection({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  if (!rows.some((row) => row[1])) return null;
  return <section className="storyboard-detail-section"><h3>{title}</h3><dl>{rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}
