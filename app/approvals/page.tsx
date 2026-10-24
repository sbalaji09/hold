import { getPersona } from "@/lib/persona";
import { listApprovals } from "@/lib/data";
import { CHECK_RESULT, citeLabel } from "@/lib/bill";
import { TEN_THOUSAND_CENTS } from "@/lib/policy";
import { shortDate } from "@/lib/inbox";
import { Amount, AccountLine, CheckRow } from "@/components/callback";
import { PushbackThread } from "@/components/PushbackThread";
import type { ApprovalKind, CheckState } from "@/lib/types";

export const metadata = { title: "Approvals · hold" };

const KIND_LABEL: Record<ApprovalKind, string> = {
  big_payment: "Over $10,000",
  held_payment: "Held",
  bank_change: "Bank change",
};

const CHECK_ORDER: Record<CheckState, number> = { flag: 0, info: 1, pass: 2 };

export default async function ApprovalsPage() {
  const [approvals, persona] = await Promise.all([listApprovals(), getPersona()]);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="cb-display text-ink">Approvals</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {persona === "dev"
            ? `Signed in as Dev Okafor, controller. ${approvals.length} waiting on your sign-off.`
            : `Signed in as Maya Lin, bookkeeper. ${approvals.length} waiting on Dev's sign-off; you can read and reply, not approve.`}
        </p>
      </div>

      {approvals.length === 0 ? (
        <div className="cb-doc p-6 text-[13px] text-ink-muted">
          Nothing waiting. Callback will ask when a payment is over <Amount cents={TEN_THOUSAND_CENTS} /> or held.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {approvals.map((approval) => {
            const bill = approval.bill;
            const checks = [...bill.checks].sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]);
            return (
              <article key={approval.key} className="cb-doc">
                <div className="cb-doc-head">
                  <span>
                    {bill.supplier.name} · Invoice {bill.invoiceNo}
                  </span>
                  <small>{KIND_LABEL[approval.kind]}</small>
                </div>
                {approval.routedTo ? (
                  <div className="border-b border-line px-4 py-2 font-mono text-[12px] text-ink-muted">
                    Routed to {approval.routedTo === "dev" ? "Dev" : "Maya"}. {approval.reason}
                  </div>
                ) : null}
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
                          quote={check.quote}
                          sources={[citeLabel(check.cite, bill)]}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-5 md:w-[300px]">
                    <div>
                      <div className="cb-caps mb-2">Pay to</div>
                      <Amount cents={bill.amountCents} size="lg" />
                      <div className="mt-3">
                        <AccountLine
                          bank={bill.bankAccount.bank}
                          routing={bill.bankAccount.routingLast4}
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
