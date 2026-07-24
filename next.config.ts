import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only native/node packages out of the client + edge bundles.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "bcryptjs",
    "nodemailer",
  ],
};

export default nextConfig;
