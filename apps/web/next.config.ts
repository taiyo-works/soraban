import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@soraban/db", "@soraban/regulations", "@soraban/geo"],
};

export default nextConfig;
