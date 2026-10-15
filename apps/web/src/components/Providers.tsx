"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { mezoTestnet, mezoMainnet, PassportProvider } from "@mezo-org/passport";
import { makeWagmiConfig } from "@/lib/wallets";
import { useState, type ReactNode } from "react";
import { CHAIN_ID } from "@/lib/env";

const wagmiConfig = makeWagmiConfig(CHAIN_ID);

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchInterval: 30_000, staleTime: 15_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider initialChain={CHAIN_ID === 31612 ? mezoMainnet : mezoTestnet} modalSize="wide" appInfo={{ appName: "Lockwatch" }} theme={darkTheme({ accentColor: "#F7931A", accentColorForeground: "#0D0C0A", borderRadius: "small", fontStack: "system", overlayBlur: "small" })}>
          <PassportProvider environment={CHAIN_ID === 31612 ? "mainnet" : "testnet"}>{children}</PassportProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
