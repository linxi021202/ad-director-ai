"use client";

import { useEffect, useRef } from "react";

type Particle = {
  angle: number;
  radius: number;
  initialRadius: number;
  angularVelocity: number;
  size: number;
  alpha: number;
  depth: number;
  trail: number;
  color: string;
  previousX: number;
  previousY: number;
};

const COLORS = ["125, 211, 252", "103, 232, 249", "186, 230, 253", "224, 247, 255"];

export function ParticleTransitionOverlay({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let startedAt = performance.now();
    let previousAt = startedAt;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createParticles(width, height);
      startedAt = performance.now();
      previousAt = startedAt;
    };

    const draw = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / 1250);
      const dt = Math.min(32, now - previousAt) / 16.667;
      previousAt = now;
      const centerX = width / 2;
      const centerY = height * 0.52;
      const attraction = smoothstep(clamp((progress - 0.1) / 0.72));
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      for (const particle of particles) {
        const depthSpeed = 0.62 + particle.depth * 0.74;
        particle.angle += particle.angularVelocity * dt * (1 + attraction * 6.4) * depthSpeed;
        const collapse = Math.pow(attraction, 1.12) * (0.78 + particle.depth * 0.16);
        particle.radius = Math.max(3, particle.initialRadius * (1 - collapse));
        const x = centerX + Math.cos(particle.angle) * particle.radius;
        const y = centerY + Math.sin(particle.angle) * particle.radius * 0.62;
        const entrance = smoothstep(clamp(progress / 0.18));
        const exit = 1 - smoothstep(clamp((progress - 0.78) / 0.22));
        const alpha = particle.alpha * entrance * exit * (0.7 + attraction * 0.5);
        const speed = Math.hypot(x - particle.previousX, y - particle.previousY);

        if (particle.trail > 0 && progress > 0.28 && speed > 1.2) {
          context.beginPath();
          context.moveTo(particle.previousX, particle.previousY);
          context.lineTo(x, y);
          context.strokeStyle = `rgba(${particle.color}, ${alpha * particle.trail})`;
          context.lineWidth = Math.max(0.45, particle.size * 0.55);
          context.stroke();
        }
        context.beginPath();
        context.arc(x, y, particle.size * (0.72 + attraction * 0.34), 0, Math.PI * 2);
        context.fillStyle = `rgba(${particle.color}, ${alpha})`;
        context.fill();
        particle.previousX = x;
        particle.previousY = y;
      }
      context.globalCompositeOperation = "source-over";
      if (progress < 1) frame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, width, height);
      particles = [];
    };
  }, [active]);

  return (
    <div className={`home-route-transition${active ? " is-active" : ""}`} aria-hidden="true">
      <canvas ref={canvasRef} className="home-route-transition__particles" />
      <div className="home-route-transition__vortex" />
      <div className="home-route-transition__glow" />
      <div className="home-route-transition__ring home-route-transition__ring--outer" />
      <div className="home-route-transition__ring home-route-transition__ring--middle" />
      <div className="home-route-transition__ring home-route-transition__ring--inner" />
      <div className="home-route-transition__core" />
      <div className="home-route-transition__bloom" />
    </div>
  );
}

function createParticles(width: number, height: number): Particle[] {
  const mobile = width < 768;
  const area = width * height;
  const count = mobile
    ? Math.round(Math.min(350, Math.max(180, area / 1800)))
    : Math.round(Math.min(900, Math.max(500, area / 2500)));
  const maxRadius = Math.hypot(width, height) * 0.72;
  return Array.from({ length: count }, (_, index) => {
    const depth = index % 11 < 5 ? 0.25 : index % 11 < 9 ? 0.62 : 1;
    const angle = Math.random() * Math.PI * 2;
    const initialRadius = maxRadius * (0.12 + Math.pow(Math.random(), 0.72) * 0.88);
    const x = width / 2 + Math.cos(angle) * initialRadius;
    const y = height * 0.52 + Math.sin(angle) * initialRadius * 0.62;
    return {
      angle,
      radius: initialRadius,
      initialRadius,
      angularVelocity: (0.0022 + Math.random() * 0.0042) * (Math.random() > 0.08 ? 1 : -0.35),
      size: depth === 1 ? 1.6 + Math.random() * 1.7 : depth > 0.5 ? 0.9 + Math.random() * 1.25 : 0.35 + Math.random() * 0.7,
      alpha: depth === 1 ? 0.74 : depth > 0.5 ? 0.5 : 0.25,
      depth,
      trail: depth === 1 ? 0.54 : depth > 0.5 && index % 4 === 0 ? 0.28 : 0,
      color: COLORS[index % COLORS.length]!,
      previousX: x,
      previousY: y
    };
  });
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}
