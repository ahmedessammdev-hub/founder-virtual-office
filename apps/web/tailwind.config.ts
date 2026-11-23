import type { Config } from "tailwindcss";

function cssRgb(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        studio: {
          ground: cssRgb("--studio-ground"),
          blueprint: cssRgb("--studio-blueprint"),
          surface: cssRgb("--studio-surface"),
          subtle: cssRgb("--studio-subtle"),
          border: cssRgb("--studio-border"),
          "border-strong": cssRgb("--studio-border-strong"),
          ink: cssRgb("--studio-ink"),
          muted: cssRgb("--studio-muted"),
          faint: cssRgb("--studio-faint"),
          accent: cssRgb("--studio-accent"),
          "accent-soft": cssRgb("--studio-accent-soft"),
          emerald: cssRgb("--studio-emerald"),
          "emerald-soft": cssRgb("--studio-emerald-soft"),
          amber: cssRgb("--studio-amber"),
          "amber-soft": cssRgb("--studio-amber-soft"),
          crimson: cssRgb("--studio-crimson"),
          "crimson-soft": cssRgb("--studio-crimson-soft"),
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', '"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        float: "0 16px 40px -12px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--studio-border))",
      },
    },
  },
  plugins: [],
} satisfies Config;
