import type { Metadata } from "next";
import type * as React from "react";
import { Sidebar } from "@/components/Sidebar";
import { AutoOpenLiveCall } from "@/components/voice";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "hold",
  description: "hold pays Fogline's bills and phones the supplier when a bank change looks wrong.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <div className="pt-app">
            <Sidebar />
            <AutoOpenLiveCall />
            <main className="pt-main">{children}</main>
          </div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
