import Link from "next/link";
import { getPersona } from "@/lib/persona";
import { countPlaybookApprovals, getCompany, listApprovals } from "@/lib/data";
import { capital, wholeDollars } from "@/lib/company";
import { CHECK_RESULT, citeLabel } from "@/lib/bill";
import { shortDate } from "@/lib/inbox";
import { Amount, AccountLine, CheckRow } from "@/components/callback";
import { PushbackThread } from "@/components/PushbackThread";
import { PlaybookApprovals } from "@/components/Playbook";
import type { ApprovalKind, CheckState } from "@/lib/types";

export const metadata = { title: "Approvals · hold" };

const kindLabel = (kind: ApprovalKind, limitCents: number): string =>
  ({ big_payment: `Over ${wholeDollars(limitCents)}`, held_payment: "Held", bank_change: "Bank change" })[kind];

const CHECK_ORDER: Record<CheckState, number> = { flag: 0, info: 1, pass: 2 };

export default async function ApprovalsPage() {
  const [approvals, changes, persona, co] = await Promise.all([listApprovals(), countPlaybookApprovals(), getPersona(), getCompany()]);
  const waiting = approvals.length + changes;

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="cb-display text-ink">Approvals</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {persona === "dev"
            ? `Signed in as ${co.dev.full}, ${co.dev.role.toLowerCase()}. ${waiting} waiting on your sign-off.`
            : `Signed in as ${co.maya.full}, ${co.maya.role.toLowerCase()}. ${waiting} waiting. Payments need ${co.dev.name}'s sign-off; you can read and reply.`}
        </p>
      </div>

      <PlaybookApprovals actor={persona} />

      {waiting === 0 ? (
        <div className="cb-doc p-6 text-[13px] text-ink-muted">
          Nothing waiting. hold will ask when a payment is over <Amount cents={co.approvalLimitCents} /> or held.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {approvals.map((approval) => {
            const bill = approval.bill;
            const checks = bill.checks.filter((c) => c.state === "flag");
            const passed = bill.checks.length - checks.length;
            return (
              <article key={approval.key} className="cb-doc">
                <div className="cb-doc-head">
                  <span>
                    {bill.supplier.name} · {capital(co.bill).one} {bill.invoiceNo}
                  </span>
                  <small>{kindLabel(approval.kind, co.approvalLimitCents)}</small>
                </div>
                <div className="flex flex-col gap-6 p-4 md:flex-row">
                  <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <div>
                      <h2 className="cb-subject text-ink">{bill.email.subject}</h2>
                      <p className="mt-2 font-mono text-[13px] leading-5 text-ink">{approval.recommendation}</p>
                    </div>
                    <div role="list" className="border-t border-line">
                      {checks.map((check, i) => (
                        <CheckRow
                          key={check.id}
                          n={i + 1}
                          result={CHECK_RESULT[check.state]}
                          title={check.label}
                          evidence={check.evidence}
                          quote={i > 0 && checks[i - 1].quote === check.quote ? undefined : check.quote}
                          sources={[citeLabel(check.cite, bill)]}
                        />
                      ))}
                    </div>
                    {passed > 0 ? <p className="border-t border-line pt-3 text-[13px] text-ink-muted">{passed} other {passed === 1 ? "check" : "checks"} passed. <Link href={`/bills/${bill.key}`} className="underline underline-offset-4">See all</Link></p> : null}
                  </div>
                  <div className="flex w-full flex-col gap-5 md:w-[300px]">
                    <div>
                      <div className="cb-caps mb-2">Pay to (account on file)</div>
                      <Amount cents={bill.amountCents} size="lg" />
                      <div className="mt-3">
                        <AccountLine
                          bank={bill.bankAccount.bank}
                          last4={bill.bankAccount.last4}
                          state="verified"
                          note={`Verified ${bill.bankAccount.verifiedBy === "onboarding" ? "at onboarding" : "by call"} \u00b7 ${shortDate(bill.bankAccount.addedAt)}`}
                        />
                      </div>
                    </div>
                    <PushbackThread actor={persona} approval={approval} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
