"use client";
// A thin line across the top of the page while a link's page is on its way. The old page stays on
// screen until the new one is ready (there is no loading screen to flash), so this is the only sign
// that the click registered.
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavProgress(): React.ReactElement | null {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = React.useState(false);

  // Any same-site link to another page starts it; the route changing ends it.
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setPending(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  React.useEffect(() => setPending(false), [pathname, search]);

  return pending ? <div className="pt-progress" role="progressbar" aria-label="Opening page" /> : null;
}
