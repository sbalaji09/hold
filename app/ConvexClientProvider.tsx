"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main style={{ maxWidth: 560, margin: "var(--space-8) auto", padding: "0 var(--space-4)" }}>
        <h1 className="cb-subject">Convex isn&apos;t connected</h1>
        <p>
          Run <code>npx convex dev</code> so <code>.env.local</code> has the deployment URL, then restart <code>npm run dev</code>.
        </p>
      </main>
    );
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
