import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "mathjs", "playwright"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  allowedDevOrigins: ["*.exe.xyz", "*.edtechathon.com"],
};

export default nextConfig;
