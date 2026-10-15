import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { base: "#0B0D10", panel: "#12151A", line: "#1F242C", btc: "#F7931A", ok: "#22C55E", warn: "#F59E0B", bad: "#EF4444", mute: "#8B95A5" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    },
  },
} satisfies Config;
