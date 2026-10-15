"use client";
import type { ReactNode } from "react";
import { Providers } from "./Providers";
import { Nav } from "./Nav";

export function ShellInner({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>
    </Providers>
  );
}
