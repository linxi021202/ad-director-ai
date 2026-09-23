"use client";

import { useEffect, useRef } from "react";

type Particle = { angle: number; radius: number; depth: number; size: number; opacity: number; speed: number; trail: boolean };
const DURATION_MS = 1660;

export function ParticleTransitionOverlay({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    let frameId = 0;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    const startedAt = performance.now();
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = makeParticles(width, height);
    };
    const draw = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const pull = ease(clamp((progress - 0.14) / 0.62));
      const release = ease(clamp((progress - 0.79) / 0.21));
      const cx = width * 0.5;
      const cy = height * 0.52;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const depthSpeed = particle.depth === 0 ? 0.3 : particle.depth === 1 ? 1 : 1.9;
        const orbit = particle.angle + progress * particle.speed * depthSpeed * (0.38 + 2.3 * pull);
        const radius = particle.radius * (1 - pull * (particle.depth === 0 ? 0.58 : 0.92));
        const nearRush = particle.depth === 2 ? release * particle.radius * 0.65 : 0;
        const x = cx + Math.cos(orbit) * (radius + nearRush);
        const y = cy + Math.sin(orbit) * (radius + nearRush) * (0.59 + particle.depth * 0.055);
        const opacity = particle.opacity * (1 - release * 0.92) * (particle.depth === 0 ? 0.72 : 1);
        const pointSize = particle.size * (1 + release * particle.depth * 0.75);
        if (particle.trail && pull > 0.12 && release < 0.8) {
          const previousOrbit = orbit - 0.026 * depthSpeed * (1 + pull * 3);
          context.beginPath();
          context.moveTo(cx + Math.cos(previousOrbit) * (radius + nearRush + 5), cy + Math.sin(previousOrbit) * (radius + nearRush + 5) * 0.65);
          context.lineTo(x, y);
          context.strokeStyle = `rgba(166,220,231,${opacity * 0.32})`;
          context.lineWidth = Math.max(0.5, pointSize * 0.45);
          context.stroke();
        }
        context.beginPath();
        context.arc(x, y, pointSize, 0, Math.PI * 2);
        context.fillStyle = `rgba(${particle.depth === 0 ? "145,182,196" : particle.depth === 1 ? "177,229,237" : "231,247,249"},${opacity})`;
        context.fill();
      }
      drawCore(context, cx, cy, progress, Math.min(width, height));
      if (progress < 1) frameId = window.requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });
    frameId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, width, height);
      particles = [];
    };
  }, [active]);

  return <div className={`home-route-transition${active ? " is-active" : ""}`} aria-hidden="true">
    <div className="home-route-transition__space" />
    <canvas ref={canvasRef} className="home-route-transition__particles" />
    <div className="home-route-transition__aperture" />
  </div>;
}

function makeParticles(width: number, height: number): Particle[] {
  const count = width < 768 ? 175 : 340;
  const radius = Math.hypot(width, height) * 0.63;
  return Array.from({ length: count }, (_, index) => {
    const depth = index % 13 < 7 ? 0 : index % 13 < 11 ? 1 : 2;
    const spread = (index * 0.61803398875) % 1;
    return {
      angle: index * 2.399963 + Math.sin(index * 7.3) * 0.28,
      radius: radius * (0.18 + Math.pow(spread, 0.7) * 0.9),
      depth,
      size: depth === 0 ? 0.42 : depth === 1 ? 0.9 : 1.65,
      opacity: depth === 0 ? 0.28 : depth === 1 ? 0.54 : 0.8,
      speed: 2.1 + (index % 9) * 0.22,
      trail: depth > 0 && index % 7 === 0
    };
  });
}

function drawCore(context: CanvasRenderingContext2D, cx: number, cy: number, progress: number, size: number) {
  const gathering = ease(clamp((progress - 0.31) / 0.46));
  const pulse = ease(clamp((progress - 0.72) / 0.12));
  const opening = ease(clamp((progress - 0.83) / 0.17));
  if (!gathering) return;
  const base = Math.min(112, size * 0.14) * (0.55 + gathering * 0.45 - pulse * 0.16);
  context.save();
  context.globalCompositeOperation = "screen";
  for (let layer = 0; layer < 5; layer += 1) {
    const angle = layer * 2.4 + progress * (layer % 2 ? -1.4 : 1.1);
    const offset = base * (layer === 0 ? 0 : 0.13 + layer * 0.05);
    const x = cx + Math.cos(angle) * offset;
    const y = cy + Math.sin(angle) * offset * 0.54;
    const radius = base * (layer === 0 ? 1.22 : 0.48 + layer * 0.1) * (1 + opening * 5.5);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${layer === 0 ? "235,249,250" : "126,211,226"},${(layer === 0 ? 0.22 : 0.075) * gathering * (1 - opening * 0.55)})`);
    gradient.addColorStop(0.35, `rgba(83,172,194,${0.07 * gathering})`);
    gradient.addColorStop(1, "rgba(35,94,122,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.57 + Math.sin(layer * 2 + progress * 4) * 0.06), angle * 0.18, 0, Math.PI * 2);
    context.fill();
  }
  const pin = Math.max(1.5, base * (0.05 + pulse * 0.02));
  const point = context.createRadialGradient(cx, cy, 0, cx, cy, pin * 4);
  point.addColorStop(0, `rgba(250,254,255,${0.68 * gathering * (1 - opening)})`);
  point.addColorStop(0.25, `rgba(217,247,249,${0.34 * gathering * (1 - opening)})`);
  point.addColorStop(1, "rgba(126,210,225,0)");
  context.fillStyle = point;
  context.beginPath();
  context.arc(cx, cy, pin * 4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function ease(value: number) { return value * value * (3 - 2 * value); }
