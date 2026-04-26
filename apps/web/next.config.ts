import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  transpilePackages: ["@soraban/db", "@soraban/regulations", "@soraban/geo"],
};

export default nextConfig;
