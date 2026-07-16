"use client";

import { useEffect, useState } from "react";

type RaycastSpotlightBackgroundProps = {
  isNavigating?: boolean;
  isExiting?: boolean;
};

export function RaycastSpotlightBackground({ isNavigating = false, isExiting = false }: RaycastSpotlightBackgroundProps) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const navigating = isNavigating || isExiting;

  useEffect(() => {
    setMousePos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const handleMouseMove = (event: MouseEvent) => {
      setMousePos({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black" aria-hidden="true">
      <style>{`
        @keyframes dramatic-flow-1 {
          0% { transform: translate(-10vw, -10vh) scale(1) rotate(0deg); }
          50% { transform: translate(30vw, 20vh) scale(1.5) rotate(90deg); }
          100% { transform: translate(-10vw, -10vh) scale(1) rotate(0deg); }
        }
        @keyframes dramatic-flow-2 {
          0% { transform: translate(10vw, 20vh) scale(1.2) rotate(0deg); }
          50% { transform: translate(-40vw, -20vh) scale(0.8) rotate(-90deg); }
          100% { transform: translate(10vw, 20vh) scale(1.2) rotate(0deg); }
        }
        @keyframes laser-shoot {
          0% { transform: translateY(100vh); opacity: 0; }
          30% { opacity: 0.7; }
          100% { transform: translateY(-100vh); opacity: 0; }
        }
        .laser-line {
          position: absolute;
          width: 1px;
          height: 150px;
          background: linear-gradient(to top, transparent, #22d3ee, transparent);
          animation: laser-shoot 0.6s infinite linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .raycast-flow,
          .raycast-spotlight,
          .laser-line {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <div className={`absolute inset-0 z-0 transition-opacity duration-700 ease-out ${navigating ? "opacity-40" : "opacity-100"}`}>
        <div className="absolute inset-0 z-0">
          <div className="absolute left-[-10%] top-[10%] h-[60vw] w-[60vw] origin-center">
            <div className="raycast-flow h-full w-full animate-[dramatic-flow-1_20s_infinite_ease-in-out] rounded-full bg-rose-600/30 mix-blend-screen blur-[120px]" />
          </div>
          <div className="absolute bottom-[-10%] right-[-10%] h-[60vw] w-[60vw] origin-center">
            <div className="raycast-flow h-full w-full animate-[dramatic-flow-2_25s_infinite_ease-in-out] rounded-full bg-cyan-600/30 mix-blend-screen blur-[120px]" />
          </div>
        </div>

        <div
          className="raycast-spotlight absolute z-0 h-[50vw] w-[50vw] rounded-full bg-indigo-500/20 mix-blend-screen blur-[140px] transition-transform duration-700 ease-out"
          style={{ transform: `translate(${mousePos.x - 400}px, ${mousePos.y - 400}px)` }}
        />

        <div className="absolute inset-0 z-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.15] mix-blend-overlay" />
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.18)_48%,rgba(0,0,0,0.82)_100%)]" />
      </div>

      {navigating ? (
        <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
          <div className="laser-line left-[15%]" style={{ animationDelay: "0s", animationDuration: "0.5s" }} />
          <div className="laser-line left-[30%]" style={{ animationDelay: "0.1s", animationDuration: "0.4s" }} />
          <div className="laser-line left-[45%]" style={{ animationDelay: "0.2s", animationDuration: "0.6s" }} />
          <div className="laser-line left-[60%]" style={{ animationDelay: "0.05s", animationDuration: "0.45s" }} />
          <div className="laser-line left-[75%]" style={{ animationDelay: "0.15s", animationDuration: "0.55s" }} />
          <div className="laser-line left-[85%]" style={{ animationDelay: "0.25s", animationDuration: "0.35s" }} />
        </div>
      ) : null}
    </div>
  );
}
