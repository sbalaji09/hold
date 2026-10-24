// What a finished check call does to its bill. Pure: callers pass the hydrated bill and the call's
// result, and apply the decision. The answers decide whether the bill is paid or held (plan step 4),
// and a confirmed call never moves money past a hard limit on its own.

import { companyFor, wholeDollars, type Company } from "./company";
import type { ApprovalKind, Bill, DataBillStatus } from "./types";

export type CallOutcome = "confirmed" | "not_confirmed" | "handed_off";

export interface CallOutcomeDecision {
  status: Extract<DataBillStatus, "Held" | "Needs you" | "Scheduled">;
  /** A pending approval to open, unless the bill already has one. */
  approval?: {
    kind: ApprovalKind;
    routedTo: "dev";
    reason: string;
    recommendation: string;
  };
  activity: { what: string; why: string };
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Call summaries come from the voice side and may lack a final full stop. */
export const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function decideCallOutcome(
  bill: Bill,
  outcome: CallOutcome,
  rawSummary: string,
  co: Company = companyFor(undefined),
): CallOutcomeDecision {
  const summary = sentence(rawSummary);
  const b = co.bill.one;
  const bankChange = bill.checks.some((c) => c.id === "bank-account" && c.state === "flag");
  const kind = bankChange ? "bank_change" : "held_payment";
  const who = bill.supplier.name;

  if (outcome === "not_confirmed") {
    return {
      status: "Held",
      approval: {
        kind,
        routedTo: "dev",
        reason: `The check call to ${who} didn't confirm this ${b}. ${summary}`,
        recommendation: `Hold this payment. ${summary}`,
      },
      activity: { what: `held this ${b} after the check call`, why: summary },
    };
  }

  if (outcome === "handed_off") {
    return {
      status: "Needs you",
      approval: {
        kind,
        routedTo: "dev",
        reason: `The check call to ${who} didn't finish. ${summary}`,
        recommendation: `Nothing was paid. ${summary} Call ${who} back or decide by hand.`,
      },
      activity: { what: `handed this ${b} to you after the check call`, why: summary },
    };
  }

  // Confirmed. A new supplier's first payment still needs your approval: there's no verified account to pay
  // yet, and Callback can't add one alone.
  if (bill.checks.some((c) => c.id === "new-supplier" && c.state === "flag")) {
    return {
      status: "Needs you",
      approval: {
        kind: "bank_change",
        routedTo: "dev",
        reason: `${who} confirmed this first ${b} on a call to the number our team confirmed. It's a new ${co.payee.one}, so your approval covers the first payment and the account it goes to.`,
        recommendation: `Approve the first payment once their bank account is verified. ${summary}`,
      },
      activity: { what: `asked for approval of a new ${co.payee.one}'s first payment`, why: summary },
    };
  }
  // Confirmed. A bank change still needs your approval: Callback can't change bank details alone.
  if (bankChange) {
    return {
      status: "Needs you",
      approval: {
        kind: "bank_change",
        routedTo: "dev",
        reason: `${who} confirmed the bank change on a call to the number on file. You have to approve the new account.`,
        recommendation: `Approve the new account. ${summary}`,
      },
      activity: { what: `asked for approval of the confirmed bank change`, why: summary },
    };
  }
  if (bill.amountCents >= co.approvalLimitCents) {
    return {
      status: "Needs you",
      approval: {
        kind: "big_payment",
        routedTo: "dev",
        reason: `${who} confirmed this ${b} on a call, but ${money(bill.amountCents)} is over hold's ${wholeDollars(co.approvalLimitCents)} limit.`,
        recommendation: `Approve this payment. ${summary}`,
      },
      activity: { what: `asked for approval of the confirmed ${b}`, why: summary },
    };
  }
  return {
    status: "Scheduled",
    activity: { what: "scheduled payment after the check call", why: `${who} confirmed this ${b} on a call to the number on file. ${summary}` },
  };
}
