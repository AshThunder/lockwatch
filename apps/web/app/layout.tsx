import "./globals.css";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Lockwatch — never let your Bitcoin sit unwatched on Mezo",
  description: "Expiry alerts and auto-protect for veBTC locks, plus borrower-side Redemption Radar for MUSD loans.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
        <footer className="border-t border-line py-6 text-center text-xs text-mute">
            Lockwatch · non-custodial · no admin keys · <a className="underline" href="https://github.com/AshThunder/lockwatch">source</a>
          </footer>
      </body>
    </html>
  );
}
