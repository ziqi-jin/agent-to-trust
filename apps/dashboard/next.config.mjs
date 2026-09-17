/** @type {import('next').NextConfig} */
const nextConfig = {
  // 子路径部署到 reeftavern.cc/credit
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '/credit',
  output: 'standalone',
  transpilePackages: ['@a2t/core', '@a2t/scoring'],
  reactStrictMode: true,
  webpack: (config) => {
    // @a2t/scoring 的 TS 源码用 ESM 风格 `.js` 后缀 import（`export * from './badges.js'`）。
    // dashboard 直接转译该包源码（transpilePackages），webpack 默认不把 .js 映射到 .ts，
    // 故这里补 extensionAlias，让 './badges.js' 解析到 './badges.ts'。
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
