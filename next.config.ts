import type { NextConfig } from "next";

/**
 * Identifies the build. On Vercel this is the commit SHA; locally it falls back
 * to the start time so a dev restart counts as a new build.
 *
 * Baked into the client bundle AND readable server-side, which is what makes an
 * update check possible: a running client carries the id of the build it was
 * served from, while /api/version reports whatever build is deployed now. If
 * they differ, the app on screen is stale.
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.BUILD_ID ||
  `dev-${Date.now()}`;

const nextConfig: NextConfig = {
  // Keep server-only native/node packages out of the client + edge bundles.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "bcryptjs",
    "nodemailer",
    "web-push",
    "@simplewebauthn/server",
  ],
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    APP_BUILD_ID: buildId,
    // The app name is configurable for emails; the client needs it too, for the
    // "add to Home Screen" copy in lib/push-client.ts.
    NEXT_PUBLIC_APP_NAME: process.env.APP_NAME || "PRO-SYS",
  },
};

export default nextConfig;
