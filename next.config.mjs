/** @type {import("next").NextConfig} */
const nextConfig = {
  env: {
    // `npx convex dev` writes the deployment URL to .env.local as VITE_CONVEX_URL or CONVEX_URL.
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL || process.env.CONVEX_URL || "",
  },
  experimental: {
    // Keep prefetched and visited tabs in the browser's router cache, so switching tabs renders
    // from memory instead of waiting on the server. Freshness comes from components/NavLinks.tsx,
    // which refreshes the cache whenever anything changes in Convex.
    staleTimes: { dynamic: 300, static: 300 },
  },
  // convex/ files import siblings as "./x.js"; let webpack resolve those to .ts.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
