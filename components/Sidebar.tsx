import * as React from "react";
import { Guilloche } from "@/components/callback";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { countPlaybookApprovals, getCompany, listApprovals, listBills, listMessages } from "@/lib/data";
import { capital } from "@/lib/company";
import { UNSETTLED_STATUS } from "@/lib/inbox";

export async function Sidebar(): Promise<React.ReactElement> {
  const [approvals, changes, bills, messages, co] = await Promise.all([
    listApprovals(),
    countPlaybookApprovals(),
    listBills(),
    listMessages(),
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
    { href: "/impact", label: "Impact", icon: "impact" },
  ];

  return (
    <aside className="pt-nav">
      <div className="pt-top">
        <div className="pt-brand">
          <Guilloche size={24} lobes={9} strands={6} className="pt-brand-seal" />
          <span className="pt-word">hold</span>
        </div>
        <WorkspaceSwitcher current={co.key} />
      </div>
      {/* renderedAt marks each server render, so the client can tell a background refresh landed. */}
      <NavLinks items={items} renderedAt={Date.now()} />
    </aside>
  );
}
