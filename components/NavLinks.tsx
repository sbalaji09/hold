"use client";
import * as React from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
// Next's own prefetch kinds; internal path, stable across 15.x. "full" is what <Link prefetch> uses.
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { refreshTabs } from "@/lib/refresh";
import { api } from "@/convex/_generated/api";
import { LayoutGrid, Inbox, CircleCheck, Landmark, Building2, Phone, ScrollText, TrendingUp } from "lucide-react";

const ICONS = { today: LayoutGrid, inbox: Inbox, approvals: CircleCheck, payments: Landmark, suppliers: Building2, phone: Phone, activity: ScrollText, impact: TrendingUp };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
  /** "you" = a person's turn (signatory tint); otherwise a plain count. */
  tone?: "you";
}

/**
 * Keeps every tab instant and current. Tabs are prefetched in full and kept in the router cache
 * (next.config.mjs staleTimes), so a click renders from memory. When anything changes in Convex the
 * open page is re-rendered in the background and the tabs are prefetched again.
 *
 * Next can drop a background refresh that races its own prefetches, so this checks rather than
 * trusts: a server render that lands after a refresh was asked for includes every change up to
 * then; until one lands, the refresh is retried.
 */
function useFreshTabs(hrefs: string[], renderedAt: number): void {
  const router = useRouter();
  const stamp = useQuery(api.app.live.changeStamp, {});
  const synced = React.useRef<number | undefined>(undefined); // the open page includes changes up to here
  const asked = React.useRef<number | undefined>(undefined); // the change we last asked a refresh for
  const inFlight = React.useRef(false);

  // Re-warm every tab after a refresh, which empties the router cache. (On first load the links'
  // own prefetch does this; doing it twice doubles the load and slows refreshes that race it.)
  // FULL fetches the tab's data, not just its loading skeleton.
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    // When the browser is idle, so a click or scroll is never stuck behind seven server renders.
    const warm = () => {
      for (const href of hrefs) router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    if (typeof window.requestIdleCallback !== "function") {
      const t = setTimeout(warm, 200);
      return () => clearTimeout(t);
    }
    const id = window.requestIdleCallback(warm, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }, [hrefs, router]);

  // A new server render arrived: its data was read after the refresh we asked for.
  React.useEffect(() => {
    if (asked.current !== undefined) synced.current = Math.max(synced.current ?? 0, asked.current);
  }, [renderedAt]);

  React.useEffect(() => {
    if (stamp === undefined) return;
    if (synced.current === undefined) {
      synced.current = stamp; // the page was just rendered by the server
      return;
    }
    if (stamp <= synced.current) return;
    // One refresh at a time: starting another while one is in flight would cancel it. Next can
    // leave a dropped refresh's promise unsettled, so one counts as finished after 4 s regardless.
    const refresh = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      asked.current = stamp;
      const done = () => (inFlight.current = false);
      const giveUp = setTimeout(done, 4000);
      refreshTabs().finally(() => {
        clearTimeout(giveUp);
        done();
      });
    };
    // Coalesce bursts (a call result writes several rows in a row), then retry until a render lands.
    const first = setTimeout(refresh, 600);
    const retry = setInterval(refresh, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(retry);
    };
  }, [stamp, renderedAt]);
}

/**
 * Tabs that load their data in the browser (Phone line, Approvals) would wait for a fresh Convex
 * subscription on every visit. Holding the same queries open here keeps their results in the Convex
 * client, so those tabs render at once. All small; listBills (large) stays with its pages.
 */
function useWarmTabs(): void {
  useQuery(api.voice.ui.phoneLine, {});
  useQuery(api.app.techniques.list, {});
  useQuery(api.app.triage.messages, {});
}

/** Marks the tab just clicked, so it highlights at once while its page loads (styled in shell.css). */
function PendingMark(): React.ReactElement | null {
  const { pending } = useLinkStatus();
  return pending ? <span className="pt-pending" hidden /> : null;
}

export function NavLinks({ items, renderedAt }: { items: NavItem[]; renderedAt: number }): React.ReactElement {
  const path = usePathname() ?? "/";
  const hrefs = React.useMemo(() => items.map((i) => i.href), [items]);
  useFreshTabs(hrefs, renderedAt);
  useWarmTabs();
  return (
    <nav className="pt-navlist" aria-label="Main">
      {items.map(({ href, label, icon, badge, tone }) => {
        const Icon = ICONS[icon];
        const on =
          href === "/" ? path === "/" : href === "/inbox" ? path === "/inbox" || path.startsWith("/bills") || path.startsWith("/messages") : path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} prefetch className={"pt-navitem" + (on ? " on" : "")} aria-current={on ? "page" : undefined}>
            <span className="pt-line">
              <Icon size={16} strokeWidth={1.5} aria-hidden />
              {label}
            </span>
            {badge ? <span className={"pt-badge" + (tone === "you" ? " pt-badge-you" : "")}>{badge}</span> : null}
            <PendingMark />
          </Link>
        );
      })}
    </nav>
  );
}
