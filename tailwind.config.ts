import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "oklch(0.18 0.025 255)",
        surface: "oklch(0.965 0.006 255)",
        panel: "oklch(0.995 0.002 255)",
        panel2: "oklch(0.93 0.01 255)",
        line: "oklch(0.84 0.018 255)",
        mist: "oklch(0.22 0.025 255)",
        muted: "oklch(0.46 0.025 255)",
        blue: "oklch(0.52 0.18 260)",
        amber: "oklch(0.55 0.12 55)",
        mint: "oklch(0.55 0.12 165)",
        clay: "oklch(0.52 0.12 35)"
      },
      boxShadow: {
        soft: "0 10px 24px oklch(0.18 0.025 255 / 0.08)",
        insetLine: "inset 0 0 0 1px oklch(0.84 0.018 255)"
      }
    }
  },
  plugins: []
};

export default config;