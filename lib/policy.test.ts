// Guards canPay's refusal reasons, including the status gate that blocks payBill/runPayments
// from touching anything outside Checking/Scheduled (lib/payments.ts's runEligibility relies on
// this same function, not a second copy of the rule).
import { describe, expect, test } from "vitest";
import { canPay } from "./policy";
import type { Bill, DataBillStatus } from "./types";

const SUPPLIER = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};

const BANK = {
  key: "bank_stage",
  supplierKey: "sup_stage",
  bank: "Chase",
  last4: "2210",
  routingLast4: "9527",
  status: "active" as const,
  verifiedBy: "onboarding" as const,
  addedAt: "2025-01-01",
};

const EMAIL = {
  key: "email_4471",
  billKey: "bill_4471",
  fromAddress: "rosa@stagecraftrigging.com",
  fromDomain: "stagecraftrigging.com",
  subject: "Invoice #4471",
  body: "Please pay invoice #4471 for $500.00.",
  receivedAt: "2026-09-19",
  direction: "in" as const,
};

function bill(status: DataBillStatus, overrides: Partial<Bill> = {}): Bill {
  return {
    key: "bill_4471",
    supplierKey: "sup_stage",
    invoiceNo: "4471",
    amountCents: 50000,
    currency: "USD",
    dueDate: "2026-09-19",
    receivedAt: "2026-09-19",
    bankAccountKey: "bank_stage",
    status,
    emailKey: "email_4471",
    planted: false,
    supplier: SUPPLIER,
    bankAccount: BANK,
    email: EMAIL,
    payment: null,
    call: null,
    checks: [],
    ...overrides,
  };
}

describe("canPay", () => {
  test("allows a Checking bill under $10k with no flags", () => {
    expect(canPay(bill("Checking")).allowed).toBe(true);
  });

  test("allows a Scheduled bill", () => {
    expect(canPay(bill("Scheduled")).allowed).toBe(true);
  });

  for (const status of ["Held", "Calling", "Needs you"] as const) {
    test(`refuses a ${status} bill`, () => {
      const result = canPay(bill(status));
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(new RegExp(status.toLowerCase()));
    });
  }

  test("words a Needs you refusal as a sentence, not \"is needs you\"", () => {
    expect(canPay(bill("Needs you")).reason).toBe("This bill needs you to review it first, not ready to pay.");
  });

  test("refuses an already-Paid bill with its own reason", () => {
    const result = canPay(bill("Paid"));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Already paid. There's nothing left to send.");
  });
});
