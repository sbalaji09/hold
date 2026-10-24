// Payments-screen-only helpers: this week's run (payments made or due within
// a 7-day window of now, plus anything still blocked) and run-button
// eligibility. Pure reads over lib/data plus the same lib/policy check the
// bill page uses — no mutation, Payments is read-only until the Increase
// sandbox integration lands.

import { listBills, listPayments } from "./data";
import { canPay } from "./policy";
import type { Bill, Payment } from "./types";

const RUN_WINDOW_MS = 7 * 24 * 3600 * 1000;

export interface RunItem {
  bill: Bill;
  payment: (Payment & { bill: Bill }) | null;
}

/** This week's payment run: payments made or due within 7 days of now, plus
 * any Held or Needs-you bill that hasn't gone out and is blocking the run. */
export async function listRun(): Promise<RunItem[]> {
  const payments = await listPayments();
  const now = Date.now();
  const recent = payments.filter((p) => Math.abs(now - new Date(p.paidAt).getTime()) <= RUN_WINDOW_MS);
  const blocked = (await listBills()).filter(
    (b) => (b.status === "Held" || b.status === "Needs you") && !payments.some((p) => p.billKey === b.key),
  );
  const items: RunItem[] = [
    ...blocked.map((bill) => ({ bill, payment: null })),
    ...recent.map((payment) => ({ bill: payment.bill, payment })),
  ];
  return items.sort((a, b) => {
    const at = a.payment ? new Date(a.payment.paidAt).getTime() : new Date(a.bill.receivedAt).getTime();
    const bt = b.payment ? new Date(b.payment.paidAt).getTime() : new Date(b.bill.receivedAt).getTime();
    return bt - at;
  });
}

export interface RunEligibility {
  eligible: RunItem[];
  lockedReason?: string;
}

/** Callback can run a payment itself only if it hasn't gone out yet and it
 * passes the same pay policy as the bill page. Anything blocked explains why
 * instead of silently dropping out of the run. */
export async function runEligibility(items: RunItem[]): Promise<RunEligibility> {
  const pending = items.filter((i) => i.payment?.status !== "Paid");
  const eligible = pending.filter((i) => canPay(i.bill).allowed);
  if (eligible.length > 0) return { eligible };
  const reason = pending.map((i) => canPay(i.bill).reason).find((r) => r);
  return { eligible, lockedReason: reason ?? "Nothing due. Every bill this week is already paid." };
}
