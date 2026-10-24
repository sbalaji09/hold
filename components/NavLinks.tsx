"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, CircleCheck, Landmark, Building2, Phone, FlaskConical, ScrollText } from "lucide-react";

const ICONS = { inbox: Inbox, approvals: CircleCheck, payments: Landmark, suppliers: Building2, phone: Phone, practice: FlaskConical, activity: ScrollText };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
  /** "you" = a person's turn (signatory tint); otherwise a plain count. */
  tone?: "you";
}

export function NavLinks({ items }: { items: NavItem[] }): React.ReactElement {
  const path = usePathname() ?? "/";
  return (
    <nav className="pt-navlist" aria-label="Main">
      {items.map(({ href, label, icon, badge, tone }) => {
        const Icon = ICONS[icon];
        const on = href === "/" ? path === "/" || path.startsWith("/bills") || path.startsWith("/messages") : path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={"pt-navitem" + (on ? " on" : "")} aria-current={on ? "page" : undefined}>
            <span className="pt-line">
              <Icon size={16} strokeWidth={1.5} aria-hidden />
              {label}
            </span>
            {badge ? <span className={"pt-badge" + (tone === "you" ? " pt-badge-you" : "")}>{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
