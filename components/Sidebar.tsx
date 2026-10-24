import * as React from "react";
import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import { Guilloche } from "@/components/callback";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { countPlaybookApprovals, getCompany, listApprovals, listBills, listMessages } from "@/lib/data";
import { capital } from "@/lib/company";
import { UNSETTLED_STATUS } from "@/lib/inbox";
import { getPersona, setPersona } from "@/lib/persona";

export async function Sidebar(): Promise<React.ReactElement> {
  const [approvals, changes, bills, messages, persona, co] = await Promise.all([
    listApprovals(),
    countPlaybookApprovals(),
    listBills(),
    listMessages(),
    getPersona(),
    getCompany(),
  ]);
  const open = bills.filter((b) => UNSETTLED_STATUS[b.status]).length + messages.open.length;
  const items: NavItem[] = [
    { href: "/", label: "Today", icon: "today" },
    { href: "/inbox", label: "Inbox", icon: "inbox", badge: open },
    { href: "/approvals", label: "Approvals", icon: "approvals", badge: approvals.length + changes, tone: "you" },
    { href: "/payments", label: "Payments", icon: "payments" },
    { href: "/suppliers", label: capital(co.payee).many, icon: "suppliers" },
    { href: "/phone", label: "Phone line", icon: "phone" },
    { href: "/activity", label: "Activity log", icon: "activity" },
  ];

  return (
    <aside className="pt-nav">
      <div className="pt-top">
        <div className="pt-brand">
          <Guilloche size={24} lobes={9} strands={6} className="pt-brand-seal" />
          <span className="pt-word">hold</span>
        </div>
        {/* The company hold works for, and the switch to another template. */}
        <Link href="/workspace" className="pt-workspace" title="Switch company">
          <span className="pt-workspace-text">
            <b>{co.name}</b>
            <span>{co.dept}</span>
          </span>
          <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
      {/* renderedAt marks each server render, so the client can tell a background refresh landed. */}
      <NavLinks items={items} renderedAt={Date.now()} />
      <div className="pt-persona">
        <span className="cb-caps">Signed in as</span>
        <form action={setPersona} className="pt-seg">
          {(
            [
              ["maya", co.maya.name, co.maya.role],
              ["dev", co.dev.name, co.dev.role],
            ] as const
          ).map(([who, name, role]) => (
            <button key={who} type="submit" name="who" value={who} className={persona === who ? "on" : undefined} aria-pressed={persona === who}>
              <b>{name}</b>
              <span>{role}</span>
            </button>
          ))}
        </form>
      </div>
    </aside>
  );
}
