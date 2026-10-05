import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs", "unpdf", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default nextConfig;
