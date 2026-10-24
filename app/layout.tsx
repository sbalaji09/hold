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
      <body className="flex bg-paper text-ink">
        <ConvexClientProvider>
          <Sidebar />
          <AutoOpenLiveCall />
          <main className="flex-1">{children}</main>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
