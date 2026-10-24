/** @type {import("next").NextConfig} */
const nextConfig = {
  env: {
    // `npx convex dev` writes the deployment URL to .env.local as VITE_CONVEX_URL or CONVEX_URL.
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || "",
  },
  // convex/ files import siblings as "./x.js"; let webpack resolve those to .ts.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
