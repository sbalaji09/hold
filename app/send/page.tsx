import Link from "next/link";
import { TryAScam } from "@/components/TryAScam";
import { getCompany } from "@/lib/data";

export const metadata = { title: "Send · hold" };

export default async function SendPage() {
  const co = await getCompany();
  return (
    <div>
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">Send a {co.bill.one}</h1>
          <p className="pt-sub">Lands in the real inbox, {co.inbox}, and goes through the same checks as any email.</p>
        </div>
        <Link href="/inbox" className="cb-btn cb-btn-secondary no-underline">
          Back to Inbox
        </Link>
      </header>
      <TryAScam />
    </div>
  );
}
