import * as React from "react";
import { Guilloche } from "@/components/callback";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { listApprovals, listBills } from "@/lib/data";
import { UNSETTLED_STATUS } from "@/lib/inbox";
import { getPersona, setPersona } from "@/lib/persona";

export async function Sidebar(): Promise<React.ReactElement> {
  const [approvals, bills, persona] = await Promise.all([listApprovals(), listBills(), getPersona()]);
  const open = bills.filter((b) => UNSETTLED_STATUS[b.status]).length;
  const items: NavItem[] = [
    { href: "/", label: "Inbox", icon: "inbox", badge: open },
    { href: "/approvals", label: "Approvals", icon: "approvals", badge: approvals.length, tone: "you" },
    { href: "/payments", label: "Payments", icon: "payments" },
    { href: "/suppliers", label: "Suppliers", icon: "suppliers" },
    { href: "/phone", label: "Phone line", icon: "phone" },
    { href: "/practice", label: "Practice", icon: "practice" },
    { href: "/activity", label: "Activity log", icon: "activity" },
  ];

  return (
    <aside className="pt-nav">
      <div className="pt-brand">
        <Guilloche size={26} lobes={9} strands={6} className="pt-brand-seal" />
        <div>
          <div className="pt-word">hold</div>
          <div className="cb-caps">Fogline · AP</div>
        </div>
      </div>
      <NavLinks items={items} />
      <div className="pt-persona">
        <span className="cb-caps">Signed in as</span>
        <form action={setPersona} className="pt-seg">
          {(
            [
              ["maya", "Maya", "Bookkeeper"],
              ["dev", "Dev", "Controller"],
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
