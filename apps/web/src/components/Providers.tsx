"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { getConfig, mezoTestnet, mezoMainnet, PassportProvider } from "@mezo-org/passport";
import { useState, type ReactNode } from "react";
import { CHAIN_ID } from "@/lib/env";

const wagmiConfig = getConfig({
  appName: "Lockwatch",
  walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "lockwatch-dev",
  mezoNetwork: CHAIN_ID === 31612 ? "mainnet" : "testnet",
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchInterval: 30_000, staleTime: 15_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider initialChain={CHAIN_ID === 31612 ? mezoMainnet : mezoTestnet} theme={darkTheme({ accentColor: "#F7931A", accentColorForeground: "#000", borderRadius: "large" })}>
          <PassportProvider environment={CHAIN_ID === 31612 ? "mainnet" : "testnet"}>{children}</PassportProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
