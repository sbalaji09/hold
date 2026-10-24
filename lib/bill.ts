// Bill-page-only helpers: the plain-words "why", cite labels and the call
// Line mapping. Pure functions over an already-hydrated Bill — no data access.

import { sentence } from "./callOutcome";
import type { Bill, Call, Check, Cite, CheckState } from "./types";
import type { CheckRowProps, LineProps } from "@/components/callback";

export const CHECK_RESULT: Record<CheckState, CheckRowProps["result"]> = {
  pass: "pass",
  flag: "fail",
  info: "warn",
};

export const CALL_LINE_STATE: Record<Call["outcome"], LineProps["state"]> = {
  confirmed: "confirmed",
  not_confirmed: "not-confirmed",
  handed_off: "no-answer",
};

export function citeLabel(cite: Cite, bill: Bill): string {
  switch (cite.kind) {
    case "email":
      return cite.ref === bill.email.key ? "This email" : `Email ${cite.ref}`;
    case "call":
      return bill.call && cite.ref === bill.call.key ? `Call · ${new Date(bill.call.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : `Call ${cite.ref}`;
    case "supplier":
      return `${bill.supplier.name} record`;
    case "bill":
      return `Invoice ${cite.ref}`;
    case "payment":
      return `Payment ${cite.ref}`;
  }
}

/** Callback's plain-words answer to "Why?", built from the checks already on
 * the bill — no model call, just the same evidence shown in the CheckRows. */
export function whyText(bill: Bill): string {
  const flagged = bill.checks.filter((c) => c.state === "flag");
  if (bill.status === "Held") {
    const evidence = flagged.map((c) => c.evidence).join(" ");
    const callNote =
      bill.call?.outcome === "not_confirmed"
        ? ` Called ${bill.supplier.contactName} on the number on file; they said they never sent this.`
        : bill.call == null
          ? " Callback hasn't reached the supplier yet."
          : "";
    return `Held this because ${evidence.charAt(0).toLowerCase() + evidence.slice(1)}${callNote} The money stays put until a person decides.`;
  }
  if (bill.status === "Needs you") {
    const amount = "$" + (bill.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (bill.call?.outcome === "handed_off") {
      return `Callback couldn't finish the check call with ${bill.supplier.name}. ${sentence(bill.call.summary)} Nothing was paid, so it's yours to decide.`;
    }
    if (bill.call?.outcome === "confirmed") {
      return flagged.some((c) => c.id === "bank-account")
        ? `${bill.supplier.contactName} confirmed the bank change on a call to the number on file. You have to approve the new account before it's paid.`
        : `${bill.supplier.contactName} confirmed this bill on a call, but ${amount} is over the $10,000 limit, so it needs your approval.`;
    }
    return `Every check passed, but ${amount} is over the $10,000 limit, so it needs your approval.`;
  }
  if (bill.status === "Scheduled" && bill.call?.outcome === "confirmed") {
    return `${bill.supplier.contactName} confirmed this bill on a call to the number on file, so it's paid on the next run.`;
  }
  if (bill.status === "Calling" || bill.status === "Checking") {
    return flagged.length > 0
      ? `Checking because ${flagged.map((c) => c.evidence).join(" ")}`
      : `Comparing this bill against ${bill.supplier.name}'s history. Nothing is decided yet.`;
  }
  return `Known account, real domain, normal amount, and it reads like ${bill.supplier.name}. Bills like this under $10,000 are paid on the next run.`;
}

/** The checks whyText's statement actually draws on, so the "Why?" popover
 * can cite them the same way CheckRow does. */
export function whyChecks(bill: Bill): Check[] {
  if (bill.status === "Held" || bill.status === "Calling" || bill.status === "Checking") {
    return bill.checks.filter((c) => c.state === "flag");
  }
  return [];
}
