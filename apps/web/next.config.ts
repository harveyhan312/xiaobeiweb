import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ws 依赖可选原生模块（buffer-util），被 webpack 打进 server bundle 会碎成
  // "b.mask is not a function"（生产模式握手即崩）；external 让它运行时走 node_modules
  serverExternalPackages: ["ws"],
};

export default nextConfig;
