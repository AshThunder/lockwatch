/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ["@lockwatch/sdk", "@lockwatch/db", "@lockwatch/services", "@mezo-org/passport", "@mezo-org/orangekit", "@mezo-org/orangekit-smart-account", "@mezo-org/orangekit-contracts"],
  experimental: { serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"] },
  webpack: (config, { webpack, isServer }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    if (isServer) {
      config.externals.push(({ request }, cb) =>
        /^(@electric-sql\/pglite|pg)(\/|$)/.test(request ?? "") ? cb(null, `commonjs ${request}`) : cb());
    }
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    // optional x402 deps pulled in transitively by @coinbase/cdp-sdk (wagmi baseAccount connector); unused here
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};
