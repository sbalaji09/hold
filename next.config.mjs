/** @type {import("next").NextConfig} */
const nextConfig = {
  env: {
    // `npx convex dev` writes the deployment URL to .env.local as VITE_CONVEX_URL or CONVEX_URL.
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || "",
  },
};

export default nextConfig;
