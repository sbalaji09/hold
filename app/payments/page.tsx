import Link from "next/link";
import { listRun, runEligibility } from "@/lib/payments";
import { getCompany, getSettings } from "@/lib/data";
import { capital } from "@/lib/company";
import { STATUS_TO_MARK } from "@/lib/inbox";
import { Amount, AccountLine, StatusMark } from "@/components/callback";
import { RunPayments } from "@/components/RunPayments";
import { WatchOnlyToggle } from "@/components/WatchOnlyToggle";
import type { DataBillStatus } from "@/lib/types";

export const metadata = { title: "Payments · hold" };

const COLS = "120px minmax(140px,1fr) 110px 230px 120px 130px";

export default async function PaymentsPage() {
  const items = await listRun();
  const [settings, co] = await Promise.all([getSettings(), getCompany()]);
  const { eligible, lockedReason } = await runEligibility(items, settings.watchOnly, co);
  const total = eligible.reduce((sum, i) => sum + i.bill.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="cb-display text-ink">Payments</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{settings.watchOnly ? "Watch only is on: hold flags bills but doesn&rsquo;t call suppliers or move money." : `${capital(co.bill).many} ready to pay, sent through the Increase test bank.`}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <WatchOnlyToggle watchOnly={settings.watchOnly} />
          <RunPayments billKeys={eligible.map((i) => i.bill.key)} total={total} lockedReason={lockedReason} />
        </div>
      </div>

      <div className="cb-doc overflow-hidden">
        <div className="grid items-center gap-3 border-b-[1.5px] border-ink px-4 py-2" style={{ gridTemplateColumns: COLS }}>
          <span className="cb-caps">{capital(co.bill).one}</span>
          <span className="cb-caps">{capital(co.payee).one}</span>
          <span className="cb-caps text-right">Amount</span>
          <span className="cb-caps">To account</span>
          <span className="cb-caps">Status</span>
          <span className="cb-caps text-right">Transfer</span>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">Nothing due. Every bill is Paid or Scheduled.</div>
        ) : (
          items.map((item) => {
            const status = ((item.payment?.status as DataBillStatus | undefined) ?? item.bill.status) as DataBillStatus;
            return (
              <Link
                key={item.bill.key}
                href={`/bills/${item.bill.key}`}
                className="grid items-center gap-3 border-t border-line px-4 py-3 text-ink hover:bg-surface-hover"
                style={{ gridTemplateColumns: COLS }}
              >
                <span className="truncate font-mono text-[12px] text-ink-muted">{item.bill.invoiceNo}</span>
                <span className="truncate text-[13px]">{item.bill.supplier.name}</span>
                <span className="text-right">
                  <Amount cents={item.bill.amountCents} />
                </span>
                <span className="[&_.cb-acct]:flex-col! [&_.cb-acct]:items-start! [&_.cb-acct]:gap-1!">
                  <AccountLine bank={item.bill.bankAccount.bank} last4={item.bill.bankAccount.last4} state="verified" />
                </span>
                <span>
                  <StatusMark status={STATUS_TO_MARK[status]} />
                </span>
                <span className="text-right font-mono text-[11.5px] text-ink-muted">
                  {item.payment?.transferId ?? "\u2014"}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
