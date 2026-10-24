import type { Metadata } from "next";
import type * as React from "react";
import { Suspense } from "react";
import { NavProgress } from "@/components/NavProgress";
import { Sidebar } from "@/components/Sidebar";
import { AutoOpenLiveCall } from "@/components/voice";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "hold",
  description: "hold pays what a company owes and phones the payee on the number on file when a bank change looks wrong.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <div className="pt-app">
            <Sidebar />
            <AutoOpenLiveCall />
            <Suspense fallback={null}>
              <NavProgress />
            </Suspense>
            <main className="pt-main">{children}</main>
          </div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
