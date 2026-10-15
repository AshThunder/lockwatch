import type { Config } from "tailwindcss";
// Lockwatch v2 — "departures board". Flap-black ground, warm white characters,
// Bitcoin orange is the departing/live lamp, amber for warnings, green for on time / protected.
export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "#0E1012", panel: "#14171A", flap: "#1B1F23", raised: "#22272C", line: "#2C3238", hair: "#1E2226",
        paper: "#F1EEE6", mute: "#A9ADAB", faint: "#82888C",
        btc: "#F7931A", "btc-hi": "#FFA53D", "btc-ink": "#1A0F02",
        signal: "#F2C14E", ok: "#62C68E", bad: "#F2705F",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
      boxShadow: {
        flap: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 2px 6px -1px rgba(0,0,0,0.55)",
        pop: "0 18px 40px -12px rgba(0,0,0,0.7), 0 2px 8px -2px rgba(0,0,0,0.5)",
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        lamp: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: { shimmer: "shimmer 1.6s linear infinite", lamp: "lamp 2.4s ease-in-out infinite" },
    },
  },
} satisfies Config;
