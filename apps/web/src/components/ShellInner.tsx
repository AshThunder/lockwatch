"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Providers } from "./Providers";
import { AppShell, SiteNav } from "./Nav";
import { ToastProvider } from "./feedback";

export function ShellInner({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <Providers>
      <ToastProvider>
        {path === "/" ? <><SiteNav /><main id="main">{children}</main></> : <AppShell>{children}</AppShell>}
      </ToastProvider>
    </Providers>
  );
}
