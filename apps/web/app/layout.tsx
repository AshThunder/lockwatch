import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Big_Shoulders_Display, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";

const display = Big_Shoulders_Display({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

const title = "Lockwatch — never miss an unlock. Never leave BTC idle.";
const description = "Never miss a veBTC unlock on Mezo. Lockwatch alerts you before each Thursday expiry, auto-extends voting power, auto-claims rewards, rescues MUSD loans, and claims, re-locks or borrows against ended locks so your BTC never sits idle.";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://lockwatch.vercel.app"),
  title: { default: title, template: "%s · Lockwatch" },
  description,
  icons: { icon: "/favicon.svg" },
  openGraph: { title, description, siteName: "Lockwatch", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title, description },
};
export const viewport: Viewport = { themeColor: "#0E1012", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
