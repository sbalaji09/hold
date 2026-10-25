"use client";

import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/callback";

/** Detail pages, and the list each one belongs to when there's nowhere in the app to go back to. */
const PARENT: Array<[RegExp, string]> = [
  [/^\/bills\/[^/]+/, "/inbox"],
  [/^\/messages\/[^/]+/, "/inbox"],
  [/^\/calls\/[^/]+/, "/phone"],
  [/^\/suppliers\/[^/]+/, "/suppliers"],
];

const NAMES: Record<string, string> = {
  "/": "Today",
  "/inbox": "Inbox",
  "/approvals": "Approvals",
  "/payments": "Payments",
  "/suppliers": "Suppliers",
  "/phone": "Phone line",
  "/activity": "Activity log",
  "/impact": "Impact",
  "/workspace": "Workspace",
};

function nameOf(path: string): string {
  if (NAMES[path]) return NAMES[path];
  if (path.startsWith("/bills/")) return "Bill";
  if (path.startsWith("/messages/")) return "Message";
  if (path.startsWith("/calls/")) return "Call";
  if (path.startsWith("/suppliers/")) return "Supplier";
  return "Back";
}

/** Shown above every detail page. Goes back the way you came (keeping the list's filters and
 * scroll), or to the page's own list when you arrived from outside the app. The layout keeps it
 * mounted, so it follows the path through the app. */
export function BackButton(): React.ReactElement | null {
  const pathname = usePathname();
  const router = useRouter();
  const trail = React.useRef<string[]>([]);
  const [prev, setPrev] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = trail.current;
    if (t[t.length - 1] === pathname) return;
    if (t[t.length - 2] === pathname) t.pop(); // went back
    else t.push(pathname);
    setPrev(t.length > 1 ? t[t.length - 2]! : null);
  }, [pathname]);

  const parent = PARENT.find(([re]) => re.test(pathname))?.[1];
  if (!parent) return null;

  return (
    <div className="mb-4">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => (prev ? router.back() : router.push(parent))}
        aria-label={`Back to ${nameOf(prev ?? parent)}`}
      >
        <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
        {nameOf(prev ?? parent)}
      </Button>
    </div>
  );
}
