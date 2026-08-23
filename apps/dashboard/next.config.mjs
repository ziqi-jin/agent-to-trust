/** @type {import('next').NextConfig} */
const nextConfig = {
  // 子路径部署到 reeftavern.cc/credit
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '/credit',
  output: 'standalone',
  transpilePackages: ['@acl/core', '@acl/scoring'],
  reactStrictMode: true,
};

export default nextConfig;
