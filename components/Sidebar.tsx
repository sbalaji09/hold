import * as React from "react";
import Link from "next/link";
import { Inbox, CircleCheck, Landmark, Building2, Phone, FlaskConical, ScrollText } from "lucide-react";
import { listApprovals } from "@/lib/data";

const ICON_PROPS = { size: 16, strokeWidth: 1.5, className: "text-ink-muted" } as const;

const NAV = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/approvals", label: "Approvals", icon: CircleCheck, countKey: "approvals" as const },
  { href: "/payments", label: "Payments", icon: Landmark },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/phone-line", label: "Phone line", icon: Phone },
  { href: "/practice", label: "Practice", icon: FlaskConical },
  { href: "/activity", label: "Activity log", icon: ScrollText },
];

export async function Sidebar(): Promise<React.ReactElement> {
  const approvals = await listApprovals();
  const counts: Record<string, number> = { approvals: approvals.length };

  return (
    <aside
      className="flex h-screen flex-col justify-between bg-surface-sunk px-4 py-5"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex flex-col gap-6">
        <span className="font-serif text-lg font-medium tracking-tight text-ink">
          hold
        </span>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon, countKey }) => {
            const count = countKey ? counts[countKey] : undefined;
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-ink hover:bg-surface-hover"
              >
                <Icon {...ICON_PROPS} />
                <span className="flex-1 text-[13px]">{label}</span>
                {count ? (
                  <span className="rounded-xs bg-signatory-tint px-1.5 text-[11px] font-mono text-signatory">
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="text-[12px] text-ink-muted">Signed in as Maya</div>
    </aside>
  );
}
