import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";
import { Wordmark } from "@/components/Logo";

const display = Archivo({ subsets: ["latin"], variable: "--font-display", axes: ["wdth"], display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Lockwatch — never let your Bitcoin sit unwatched on Mezo",
  description: "Expiry alerts and auto-protect for veBTC locks, plus borrower-side Redemption Radar for MUSD loans.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { themeColor: "#0D0C0A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Shell>{children}</Shell>
        <footer className="mt-auto border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-mute">
            <Wordmark className="h-5 text-paper" />
            <span>Non-custodial. No admin keys. No upgrade path.</span>
            <a className="link" href="https://github.com/AshThunder/lockwatch">Source on GitHub</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
