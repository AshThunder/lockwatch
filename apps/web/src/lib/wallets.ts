import { getDefaultConfig, type WalletList } from "@rainbow-me/rainbowkit";
import {
  injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, rabbyWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import {
  mezoTestnet, mezoMainnet,
  unisatWalletMezoTestnet, okxWalletMezoTestnet, xverseWalletMezoTestnet,
  unisatWalletMezoMainnet, okxWalletMezoMainnet, xverseWalletMezoMainnet,
} from "@mezo-org/passport";

/** WalletConnect project id (Reown Cloud). Optional: without it only injected/extension wallets are offered. */
export const WC_PROJECT_ID = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "").trim();
export const HAS_WALLETCONNECT = WC_PROJECT_ID.length > 0;

/** Standard RainbowKit wallet list, with Mezo Passport's Bitcoin wallets as an extra group. */
export function walletList(mainnet: boolean, hasWc = HAS_WALLETCONNECT): WalletList {
  const evm = hasWc
    ? [metaMaskWallet, rainbowWallet, coinbaseWallet, rabbyWallet, walletConnectWallet]
    : [injectedWallet, rabbyWallet]; // extension-only, no WalletConnect relay needed
  const btc = mainnet
    ? [unisatWalletMezoMainnet, okxWalletMezoMainnet, xverseWalletMezoMainnet]
    : [unisatWalletMezoTestnet, okxWalletMezoTestnet, xverseWalletMezoTestnet];
  return [
    { groupName: "Popular", wallets: evm },
    { groupName: "Bitcoin (Mezo Passport)", wallets: btc as WalletList[number]["wallets"] },
  ];
}

export function makeWagmiConfig(chainId: number) {
  const mainnet = chainId === 31612;
  const chain = mainnet ? mezoMainnet : mezoTestnet;
  return getDefaultConfig({
    appName: "Lockwatch",
    // RainbowKit requires a string; the placeholder is never used because no WC-based wallet is listed without a real id.
    projectId: HAS_WALLETCONNECT ? WC_PROJECT_ID : "lockwatch-no-walletconnect",
    chains: [chain],
    transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) },
    wallets: walletList(mainnet),
    multiInjectedProviderDiscovery: true,
    ssr: true,
  });
}
