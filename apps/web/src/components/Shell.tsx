"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Mezo Passport touches `document` at import time, so the wallet stack only renders in the browser.
const Inner = dynamic(() => import("./ShellInner").then((m) => m.ShellInner), {
  ssr: false,
  loading: () => <div className="h-[109px] border-b border-line md:h-16" />,
});
export function Shell({ children }: { children: ReactNode }) {
  return <Inner>{children}</Inner>;
}
