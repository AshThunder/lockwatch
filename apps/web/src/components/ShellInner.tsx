"use client";
import type { ReactNode } from "react";
import { Providers } from "./Providers";
import { Nav } from "./Nav";

export function ShellInner({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 md:pt-14">{children}</main>
    </Providers>
  );
}
