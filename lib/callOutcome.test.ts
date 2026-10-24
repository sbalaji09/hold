import { describe, expect, test } from "vitest";
import { whyText } from "./bill";
import { decideCallOutcome } from "./callOutcome";
import type { Bill, Check } from "./types";

const BANK_FLAG: Check = {
  id: "bank-account",
  label: "Bank account",
  state: "flag",
  evidence: "Bank account never used before.",
  cite: { kind: "email", ref: "email_4471" },
};
const RUSH_FLAG: Check = { ...BANK_FLAG, id: "rush", label: "Rush language", evidence: "Asks to pay today." };

function bill(over: Partial<Bill> = {}): Bill {
  return {
    key: "bill_in_1",
    supplierKey: "sup_stage",
    invoiceNo: "4502",
    amountCents: 1_840_000,
    currency: "USD",
    dueDate: "2026-10-30",
    receivedAt: "2026-10-23T16:00:00.000Z",
    bankAccountKey: "bank_new",
    status: "Calling",
    emailKey: "email_in_1",
    planted: false,
    supplier: {
      key: "sup_stage",
      name: "Stagecraft Rigging Co.",
      category: "stage",
      domain: "stagecraftrigging.com",
      contactName: "Rosa Quintero",
      contactEmail: "rosa@stagecraftrigging.com",
      trustedPhone: "+14155550100",
      phoneLastCheckedAt: "2026-09-19",
    },
    bankAccount: { key: "bank_new", supplierKey: "sup_stage", bank: "Mercury", last4: "8817", routingLast4: "0001", status: "active", verifiedBy: "onboarding", addedAt: "2026-10-23" },
    email: { key: "email_in_1", billKey: "bill_in_1", fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com", subject: "Invoice", body: "", receivedAt: "2026-10-23T16:00:00.000Z", direction: "in" },
    payment: null,
    call: null,
    checks: [BANK_FLAG],
    ...over,
  };
}

describe("decideCallOutcome", () => {
  test("not confirmed: held, Dev decides, the call summary is the reason", () => {
    const d = decideCallOutcome(bill(), "not_confirmed", "Supplier says they never changed their bank details.");
    expect(d.status).toBe("Held");
    expect(d.approval).toMatchObject({ kind: "bank_change", routedTo: "dev" });
    expect(d.approval!.reason).toContain("never changed their bank details");
  });

  test("handed off: it's yours to decide, never paid", () => {
    const d = decideCallOutcome(bill({ checks: [RUSH_FLAG] }), "handed_off", "No answer after 2 attempts.");
    expect(d.status).toBe("Needs you");
    expect(d.approval).toMatchObject({ kind: "held_payment", routedTo: "dev" });
    expect(d.approval!.reason).toContain("No answer after 2 attempts.");
  });

  test("a summary without a full stop still reads as sentences", () => {
    const d = decideCallOutcome(bill(), "handed_off", "No answer after 2 attempts");
    expect(d.approval!.recommendation).toBe("Nothing was paid. No answer after 2 attempts. Call Stagecraft Rigging Co. back or decide by hand.");
  });

  test("a confirmed bank change still needs Dev, even under $10,000", () => {
    const d = decideCallOutcome(bill({ amountCents: 50_000 }), "confirmed", "Supplier confirmed the change.");
    expect(d.status).toBe("Needs you");
    expect(d.approval).toMatchObject({ kind: "bank_change", routedTo: "dev" });
  });

  test("a new supplier's confirmed first bill still goes to Dev, even when small", () => {
    const NEW: Check = { ...BANK_FLAG, id: "new-supplier", label: "New supplier", evidence: "Fogline has never paid them." };
    const d = decideCallOutcome(bill({ checks: [NEW], amountCents: 50_000 }), "confirmed", "Supplier confirmed the job.");
    expect(d.status).toBe("Needs you");
    expect(d.approval).toMatchObject({ routedTo: "dev" });
    expect(d.approval!.reason).toContain("new supplier");
  });

  test("confirmed without a bank change: $10,000 or more goes to Dev, less is scheduled", () => {
    expect(decideCallOutcome(bill({ checks: [RUSH_FLAG] }), "confirmed", "ok").approval).toMatchObject({ kind: "big_payment", routedTo: "dev" });
    const small = decideCallOutcome(bill({ checks: [RUSH_FLAG], amountCents: 999_999 }), "confirmed", "ok");
    expect(small.status).toBe("Scheduled");
    expect(small.approval).toBeUndefined();
  });
});

describe("whyText after a check call", () => {
  const call = (outcome: "confirmed" | "handed_off", summary: string) => ({
    key: "call_1", supplierKey: "sup_stage", billKey: "bill_in_1", direction: "out" as const, startedAt: "", transcript: [], outcome, summary,
  });

  test("a handed-off bill says what happened on the call, not that it is over $10,000", () => {
    const text = whyText(bill({ status: "Needs you", amountCents: 50_000, call: call("handed_off", "No answer after 2 attempts") }));
    expect(text).toContain("No answer after 2 attempts. Nothing was paid");
    expect(text).not.toContain("$10,000");
  });

  test("a confirmed bank change says You have to approve the new account", () => {
    expect(whyText(bill({ status: "Needs you", call: call("confirmed", "ok") }))).toMatch(/Rosa Quintero confirmed the bank change.*You have to approve/);
  });

  test("a confirmed small bill says why it will be paid", () => {
    expect(whyText(bill({ status: "Scheduled", checks: [RUSH_FLAG], amountCents: 50_000, call: call("confirmed", "ok") }))).toContain("confirmed this bill on a call");
  });
});
