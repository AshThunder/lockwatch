import type { Config } from "tailwindcss";
// Lockwatch — "chronograph" system. Warm ink ground, paper text, one Bitcoin-orange hand.
export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0D0C0A", panel: "#151411", raised: "#1C1A16", line: "#2A2722", hair: "#211F1B",
        paper: "#EEE8DC", mute: "#A39C8E", faint: "#6F695E",
        btc: "#F7931A", "btc-deep": "#C46F0B",
        ok: "#6CC08A", warn: "#E9B44C", bad: "#EE6A5F",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: { shimmer: "shimmer 1.6s linear infinite" },
    },
  },
} satisfies Config;
