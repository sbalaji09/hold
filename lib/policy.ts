// Pure rules for what Callback and the approver can each do. No data access,
// no side effects — callers pass in the records they already have.

import { companyFor, wholeDollars, type Company } from "./company";
import type { Bill } from "./types";

const FOGLINE = companyFor(undefined);

export type Actor = "callback" | "dev";

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export const TEN_THOUSAND_CENTS = 1_000_000;

function allowed(): PolicyResult {
  return { allowed: true };
}

function denied(reason: string): PolicyResult {
  return { allowed: false, reason };
}

export const WATCH_ONLY_REASON = "Watch only is on. hold flags and calls but doesn't move money.";

/** Whether anything is allowed to move money right now, independent of the bill at hand. */
export function canMoveMoney(watchOnly: boolean): PolicyResult {
  if (watchOnly) return denied(WATCH_ONLY_REASON);
  return allowed();
}

/** Callback can pay safe bills under the company's approval limit only. */
export function canPay(bill: Bill, watchOnly = false, co: Company = FOGLINE): PolicyResult {
  if (bill.status === "Paid") return denied("Already paid. There's nothing left to send.");
  if (bill.status !== "Checking" && bill.status !== "Scheduled") {
    if (bill.status === "Needs you") return denied(`This ${co.bill.one} needs you to review it first, not ready to pay.`);
    return denied(`This ${co.bill.one} is ${bill.status.toLowerCase()}, not ready to pay.`);
  }
  const moneyCheck = canMoveMoney(watchOnly);
  if (!moneyCheck.allowed) return moneyCheck;
  const flagged = bill.checks.find((c) => c.state === "flag");
  if (flagged) return denied(`hold can't pay this ${co.bill.one}. ${flagged.label} didn't check out.`);
  if (bill.amountCents >= co.approvalLimitCents) {
    const Bills = co.bill.many.charAt(0).toUpperCase() + co.bill.many.slice(1);
    return denied(`hold can't pay this on its own. ${Bills} of ${wholeDollars(co.approvalLimitCents)} or more need your approval.`);
  }
  return allowed();
}

/** Callback can hold any bill that hasn't already been paid. */
export function canHold(bill: Bill): PolicyResult {
  if (bill.status === "Paid") return denied("Already paid. There's nothing left to hold.");
  if (bill.status === "Held") return denied("Already held.");
  return allowed();
}

/** Callback can call the supplier's on-file number for anything still open. */
export function canCall(bill: Bill): PolicyResult {
  if (bill.status === "Paid") return denied("Already paid. No reason to call.");
  if (!bill.supplier.trustedPhone) return denied("No number on file yet. Run the background check and confirm a number first.");
  return allowed();
}

/** Callback can't approve its own requests; nobody else is blocked from signing off. */
export function canApprove(approver: Actor, requestedBy: Actor, co: Company = FOGLINE): PolicyResult {
  if (approver === "callback") return denied("hold can't approve its own requests. It needs your approval.");
  if (approver === requestedBy) return denied("You can't approve a request you made yourself.");
  return allowed();
}

/** Releasing a held payment needs a person, and a bank change on it needs your approval plus a confirmed call. */
export function canRelease(bill: Bill, releaser: Actor, co: Company = FOGLINE): PolicyResult {
  if (bill.status !== "Held") return denied(`This ${co.bill.one} isn't held.`);
  if (releaser === "callback") return denied("hold can't release a held payment. It needs your approval.");
  const bankFlagged = bill.checks.find((c) => c.id === "bank-account")?.state === "flag";
  if (bankFlagged) {
    if (releaser !== "dev") return denied(`This release needs your approval: the bank details on this ${co.bill.one} changed.`);
    if (bill.call?.outcome !== "confirmed") {
      return denied(`hold can't change bank details without a confirmed call. Call the ${co.payee.one} on the number on file first.`);
    }
  }
  return allowed();
}
