// Pure rules for what Callback, Maya and Dev can each do. No data access,
// no side effects — callers pass in the records they already have.

import type { Bill } from "./types";

export type Actor = "callback" | "maya" | "dev";

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

/** Callback can pay under $10k safe bills only. */
export function canPay(bill: Bill): PolicyResult {
  if (bill.status === "Paid") return denied("Already paid. There's nothing left to send.");
  const flagged = bill.checks.find((c) => c.state === "flag");
  if (flagged) return denied(`Callback can't pay this bill. ${flagged.label} didn't check out.`);
  if (bill.amountCents >= TEN_THOUSAND_CENTS) {
    return denied("Callback can't pay this on its own. Bills of $10,000 or more need Dev's approval.");
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
  return allowed();
}

/** Nobody can approve a request they made themselves, and Callback can't sign at all. */
export function canApprove(approver: Actor, requestedBy: Actor): PolicyResult {
  if (approver === "callback") return denied("Callback can't approve its own requests. Maya or Dev has to sign off.");
  if (approver === requestedBy) return denied(`${approver === "maya" ? "Maya" : "Dev"} can't approve a request they made themselves.`);
  return allowed();
}

/** Releasing a held payment needs a person, and a bank change on it needs Dev plus a confirmed call. */
export function canRelease(bill: Bill, releaser: Actor): PolicyResult {
  if (bill.status !== "Held") return denied("This bill isn't held.");
  if (releaser === "callback") return denied("Callback can't release a held payment. Dev has to approve it.");
  const bankFlagged = bill.checks.find((c) => c.id === "bank-account")?.state === "flag";
  if (bankFlagged) {
    if (releaser !== "dev") return denied("This release needs Dev's approval: the bank details on this bill changed.");
    if (bill.call?.outcome !== "confirmed") {
      return denied("Callback can't change bank details without a confirmed call. Call the supplier on the number on file first.");
    }
  }
  return allowed();
}
