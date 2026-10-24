// Minimal root layout so the voice screens run. The app shell (sidebar, Inbox) replaces the body.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AutoOpenLiveCall } from "@/components/voice";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "@/design/callback/tokens.css";
import "@/design/callback/components/bundle.css";

export const metadata: Metadata = { title: "hold" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <AutoOpenLiveCall />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
