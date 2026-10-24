import { convexTest } from "convex-test";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide, runChecks, type CheckBankAccount, type RunChecksInput } from "./checks.js";
import { descriptionFromBody } from "./practice.js";

// Fixtures drawn straight from data/fogline.json — the legit-mess rows
// documented under "Legitimate mess (must NOT be held)" in
// data/planted-scams.md: odd invoice-number formats, emails that drop the
// invoice number from the body, casual supplier phrasing, and the third
// dev+call-verified bank change (SF Fence & Barricade Co.).
const fogline = JSON.parse(readFileSync(join(import.meta.dirname, "../../data/fogline.json"), "utf8")) as {
  suppliers: Array<{ key: string; name: string; domain: string }>;
  bankAccounts: Array<{ key: string; supplierKey: string; bank: string; last4: string; verifiedBy: "onboarding" | "call+dev" }>;
  bills: Array<{ key: string; supplierKey: string; amountCents: number; bankAccountKey: string; status: string; emailKey: string }>;
  emails: Array<{ key: string; billKey: string; fromAddress: string; fromDomain: string; body: string }>;
  calls: Array<{ billKey: string; outcome: string }>;
};

/** Mirrors convex/app/practice.ts's gatherRow, but reads the flat seed JSON
 * directly instead of Convex tables (no ctx needed for a unit test). */
function inputForBill(billKey: string): RunChecksInput {
  const bill = fogline.bills.find((b) => b.key === billKey);
  if (!bill) throw new Error(`fixture bill ${billKey} not found in fogline.json`);
  const email = fogline.emails.find((e) => e.key === bill.emailKey)!;
  const supplier = fogline.suppliers.find((s) => s.key === bill.supplierKey)!;
  const bankAccount = fogline.bankAccounts.find((a) => a.key === bill.bankAccountKey)!;
  const confirmedByCall = fogline.calls.some((c) => c.billKey === billKey && c.outcome === "confirmed");

  const pastPaid = fogline.bills.filter((b) => b.supplierKey === supplier.key && b.status === "Paid" && b.key !== bill.key);
  const pastPaidBankAccounts: CheckBankAccount[] = pastPaid.map((b) => {
    const acct = fogline.bankAccounts.find((a) => a.key === b.bankAccountKey);
    return { bank: acct?.bank ?? "", last4: acct?.last4 ?? "" };
  });

  return {
    email: { fromAddress: email.fromAddress, fromDomain: email.fromDomain, body: email.body },
    supplier: { key: supplier.key, name: supplier.name, domain: supplier.domain },
    currentBankAccount: { bank: bankAccount.bank, last4: bankAccount.last4, verifiedBy: bankAccount.verifiedBy, confirmedByCall },
    pastPaidBankAccounts,
    pastPaidAmounts: pastPaid.map((b) => b.amountCents),
    amountCents: bill.amountCents,
  };
}

// 6 odd invoice-number formats + 2 missing-invoice-in-body + 3 casual-phrasing bills.
const LEGIT_MESS_BILLS = [
  "bill_4005",
  "bill_4019",
  "bill_4036",
  "bill_4059",
  "bill_4083",
  "bill_4110",
  "bill_4025",
  "bill_4097",
  "bill_4013",
  "bill_4064",
  "bill_4116",
];

test.each(LEGIT_MESS_BILLS)("legit-mess bill %s is never flagged by runChecks", (billKey) => {
  const checks = runChecks(inputForBill(billKey));
  expect(checks.every((c) => c.state !== "flag")).toBe(true);
  expect(decide(checks, inputForBill(billKey).amountCents)).toBe("pay");
});

test("third verified bank change (SF Fence & Barricade Co. -> Silicon Valley Bank ..3384) is not held", () => {
  const input = inputForBill("bill_4147");
  expect(input.currentBankAccount.bank).toBe("Silicon Valley Bank");
  expect(input.currentBankAccount.last4).toBe("3384");
  expect(input.currentBankAccount.verifiedBy).toBe("call+dev");
  expect(input.currentBankAccount.confirmedByCall).toBe(true);
  const checks = runChecks(input);
  expect(checks.every((c) => c.state !== "flag")).toBe(true);
  expect(decide(checks, input.amountCents)).toBe("pay");
});

test("descriptionFromBody truncates to 160 chars, deduping on the same prefix", () => {
  const long = "x".repeat(200);
  const description = descriptionFromBody(long);
  expect(description).toHaveLength(160);
  expect(description).toBe(descriptionFromBody(long + " different tail"));
});

type AppApi = { app: { practice: Record<string, any>; queries: Record<string, any> } };
// api is Convex's anyApi proxy; convex/_generated/api.d.ts hasn't been regenerated for this new
// `app` module, so this cast documents the shape test code relies on (never user input).
const appApi = api as unknown as AppApi;

test("insertGenerated marks bills practice: true, excluded from listBills but present via getBill", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("suppliers", {
      key: "sup_stage",
      name: "Stagecraft Rigging Co.",
      category: "stage",
      domain: "stagecraftrigging.com",
      contactName: "Rosa Quintero",
      contactEmail: "rosa@stagecraftrigging.com",
      trustedPhone: "+14155550100",
      phoneLastCheckedAt: "2026-09-19",
    });
    await ctx.db.insert("bankAccounts", {
      key: "bank_stage",
      supplierKey: "sup_stage",
      bank: "Chase",
      last4: "2210",
      routingLast4: "9527",
      status: "active",
      verifiedBy: "onboarding",
      addedAt: "2025-01-01",
    });
  });
  const inserted = await t.mutation(appApi.app.practice.insertGenerated, {
    scams: [
      {
        kind: "rush",
        from: "scammer@evil.example",
        fromDomain: "evil.example",
        subject: "Urgent invoice",
        body: "Please pay immediately to this new account.",
        supplierKey: "sup_stage",
        amountCents: 100_000,
        checksThatShouldFire: ["rush language"],
      },
    ],
  });
  expect(inserted).toBe(1);

  const bills = await t.run((ctx) => ctx.db.query("bills").collect());
  expect(bills).toHaveLength(1);
  const practiceBill = bills[0]!;
  expect(practiceBill.practice).toBe(true);

  const listed = await t.query(appApi.app.queries.listBills, {});
  expect(listed.find((b: { key: string }) => b.key === practiceBill.key)).toBeUndefined();

  const fetched = await t.query(appApi.app.queries.getBill, { key: practiceBill.key });
  expect(fetched?.key).toBe(practiceBill.key);
});
