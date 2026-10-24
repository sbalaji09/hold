"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

// With no deployment configured the app still renders from data/fogline.json; live hooks just
// stay idle against the local-dev default address until `npx convex dev` writes the real URL.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210");

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
