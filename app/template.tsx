import type * as React from "react";

/** Re-mounts on every navigation (unlike the layout), so each new page fades in instead of snapping. */
export default function Template({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="pt-page">{children}</div>;
}
