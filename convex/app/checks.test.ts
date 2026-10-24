import { expect, test } from "vitest";
import { decide, routeEscalation, runChecks } from "./checks.js";

// Fixtures drawn from data/fogline.json (Stagecraft Rigging, sup_stage / bank_stage) and the
// live demo scam described in data/planted-scams.md, which is never in the seed.

const stagecraftSupplier = { key: "sup_stage", name: "Stagecraft Rigging Co.", domain: "stagecraftrigging.com" };
const stagecraftAccount = { bank: "Chase", last4: "2210", verifiedBy: "onboarding" as const };
// 10 of Stagecraft's 11 seeded bills are past-paid history for the 11th (bill_4471 / the live scam).
const stagecraftPastAmounts = [312207, 386988, 334823, 251307, 651169, 788746, 256907, 228668, 655858, 697939];
const stagecraftPastAccounts = stagecraftPastAmounts.map(() => ({ bank: "Chase", last4: "2210" }));

test("routine bill under $10k with known bank account decides pay", () => {
  const checks = runChecks({
    email: {
      body: "Hi team,\n\nPlease find attached invoice #4138 in the amount of $6,558.58, payable by 2026-09-15. Kindly remit to the account on file.\n\nThanks,\nRosa Quintero",
      fromAddress: "rosa@stagecraftrigging.com",
      fromDomain: "stagecraftrigging.com",
    },
    supplier: stagecraftSupplier,
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: stagecraftPastAccounts,
    pastPaidAmounts: stagecraftPastAmounts,
    amountCents: 655858,
  });
  expect(checks.every((c) => c.state !== "flag")).toBe(true);
  expect(decide(checks, 655858)).toBe("pay");
});

test("live demo scam: real address but new bank account + rush language + style mismatch decides call", () => {
  const email = {
    body:
      "Hi team,\n\nWe've had to switch banks urgently this week due to an issue with our old account. " +
      "Can you please redirect payment for invoice #4471 ($18,400.00) to our new account below? " +
      "We need this today — our vendor payments are blocked until this clears.\n\n" +
      "New account: Mercury, account ending 8817.\n\nThanks for the quick turnaround,\nRosa Quintero\nStagecraft Rigging Co.",
    fromAddress: "rosa@stagecraftrigging.com",
    fromDomain: "stagecraftrigging.com",
  };
  const checks = runChecks({
    email,
    supplier: stagecraftSupplier,
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: stagecraftPastAccounts,
    pastPaidAmounts: stagecraftPastAmounts,
    amountCents: 1840000,
    styleMatch: { matches: false, reasons: ["Past emails sign off 'Thanks, Rosa Quintero'; this one is noticeably more formal."] },
  });

  const bank = checks.find((c) => c.id === "bank-account")!;
  const domain = checks.find((c) => c.id === "domain")!;
  const rush = checks.find((c) => c.id === "rush-language")!;
  const style = checks.find((c) => c.id === "writing-style")!;

  expect(bank.state).toBe("flag");
  expect(domain.state).toBe("pass"); // real address, so the domain check passes
  expect(rush.state).toBe("flag");
  expect(style.state).toBe("flag");
  expect(decide(checks, 1840000)).toBe("call");
});

test("seeded scam: look-alike domain + new bank account + rush language all flag", () => {
  const checks = runChecks({
    email: {
      body: "Hi,\n\nWe've moved banks — please pay invoice #4140 to our new Mercury account today, before close of business.\n\nThanks",
      fromAddress: "billing@gg-trussdeck.com",
      fromDomain: "gg-trussdeck.com",
    },
    supplier: { key: "sup_gg_truss", name: "Golden Gate Truss & Deck", domain: "ggtrussdeck.com" },
    currentBankAccount: { bank: "Mercury", last4: "4471", verifiedBy: "onboarding" },
    pastPaidBankAccounts: [{ bank: "Mercury", last4: "4471" }],
    pastPaidAmounts: [320000],
    amountCents: 410000,
  });
  const bank = checks.find((c) => c.id === "bank-account")!;
  const domain = checks.find((c) => c.id === "domain")!;
  const rush = checks.find((c) => c.id === "rush-language")!;
  expect(bank.state).toBe("flag");
  expect(domain.state).toBe("flag");
  expect(rush.state).toBe("flag");
  expect(decide(checks, 410000)).toBe("call");
});

test("look-alike domain evidence includes registered-days only when provided", () => {
  const base = {
    email: { body: "Please pay invoice #1 on file.", fromAddress: "a@evil.com", fromDomain: "evil.com" },
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: [],
    pastPaidAmounts: [],
    amountCents: 1000,
  };
  const withoutDays = runChecks({ ...base, supplier: { key: "s", name: "S", domain: "real.com" } });
  const withDays = runChecks({ ...base, supplier: { key: "s", name: "S", domain: "real.com", domainRegisteredDays: 4 } });
  expect(withoutDays.find((c) => c.id === "domain")!.evidence).not.toMatch(/registered/);
  expect(withDays.find((c) => c.id === "domain")!.evidence).toMatch(/registered 4 days ago/);
});

test("a legit call+dev-verified bank change passes instead of flagging", () => {
  const checks = runChecks({
    email: { body: "Please pay invoice #5 on file.", fromAddress: "a@perimeterprostaffing.com", fromDomain: "perimeterprostaffing.com" },
    supplier: { key: "sup_perimeter_pro", name: "Perimeter Pro Staffing", domain: "perimeterprostaffing.com" },
    currentBankAccount: { bank: "US Bank", last4: "5509", verifiedBy: "call+dev", confirmedByCall: true },
    pastPaidBankAccounts: [{ bank: "US Bank", last4: "9149" }],
    pastPaidAmounts: [444719],
    amountCents: 92304,
  });
  expect(checks.find((c) => c.id === "bank-account")!.state).toBe("pass");
  expect(decide(checks, 92304)).toBe("pay");
});

test("safe bill over $10k asks dev instead of paying", () => {
  const checks = runChecks({
    email: {
      body: "Please find attached invoice #4190 in the amount of $11000.00. Kindly remit to the account on file.",
      fromAddress: "rosa@stagecraftrigging.com",
      fromDomain: "stagecraftrigging.com",
    },
    supplier: stagecraftSupplier,
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: stagecraftPastAccounts,
    pastPaidAmounts: stagecraftPastAmounts,
    amountCents: 1100000,
  });
  expect(checks.every((c) => c.state !== "flag")).toBe(true);
  expect(decide(checks, 1100000)).toBe("ask_dev");
});

test("a learned rule naming the exact bank + last4 can never turn an unverified new-account flag into a pass", () => {
  const base = {
    email: { body: "Please find attached invoice #6 in the amount of $900.00. Pay to the account on file.", fromAddress: "a@perimeterprostaffing.com", fromDomain: "perimeterprostaffing.com" },
    supplier: { key: "sup_perimeter_pro", name: "Perimeter Pro Staffing", domain: "perimeterprostaffing.com" },
    currentBankAccount: { bank: "US Bank", last4: "5509", verifiedBy: "onboarding" as const },
    pastPaidBankAccounts: [{ bank: "US Bank", last4: "9149" }],
    pastPaidAmounts: [444719],
    amountCents: 90000,
  };
  const withoutRule = runChecks(base);
  expect(withoutRule.find((c) => c.id === "bank-account")!.state).toBe("flag");

  const withRule = runChecks({
    ...base,
    learnedRules: [{ text: "Dev verified account US Bank \u00b7\u00b75509 for Perimeter Pro Staffing.", sourceKind: "bill", sourceKey: "bill_5" }],
  });
  expect(withRule.find((c) => c.id === "bank-account")!.state).toBe("flag");
  expect(decide(withRule, 90000)).toBe("call");
});

test("'Learned rule applies' info check cites the rule that was saved", () => {
  const checks = runChecks({
    email: { body: "Please find attached invoice #7 in the amount of $900.00. Pay to the account on file.", fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com" },
    supplier: stagecraftSupplier,
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: stagecraftPastAccounts,
    pastPaidAmounts: stagecraftPastAmounts,
    amountCents: 90000,
    learnedRules: [{ text: "Stagecraft always rushes invoices at month end; that's normal for them.", sourceKind: "bill", sourceKey: "bill_4471" }],
  });
  const ruleCheck = checks.find((c) => c.id === "learned-rule");
  expect(ruleCheck).toBeDefined();
  expect(ruleCheck!.state).toBe("info");
  expect(ruleCheck!.evidence).toBe("Stagecraft always rushes invoices at month end; that's normal for them.");
  expect(ruleCheck!.cite).toEqual({ kind: "bill", ref: "bill_4471" });
});

test("a learned rule can never let a literal bank-change request through", () => {
  const checks = runChecks({
    email: {
      body: "We've switched banks. Please pay invoice #8 ($900.00) to our new account below.\n\nNew account: US Bank, account ending 5509.",
      fromAddress: "a@perimeterprostaffing.com",
      fromDomain: "perimeterprostaffing.com",
    },
    supplier: { key: "sup_perimeter_pro", name: "Perimeter Pro Staffing", domain: "perimeterprostaffing.com" },
    currentBankAccount: { bank: "US Bank", last4: "5509", verifiedBy: "onboarding" },
    pastPaidBankAccounts: [{ bank: "US Bank", last4: "9149" }],
    pastPaidAmounts: [444719],
    amountCents: 90000,
    learnedRules: [{ text: "Dev verified account US Bank \u00b7\u00b75509 for Perimeter Pro Staffing.", sourceKind: "bill", sourceKey: "bill_5" }],
  });
  expect(checks.find((c) => c.id === "bank-account")!.state).toBe("flag");
  expect(decide(checks, 90000)).toBe("call");
});

test("routeEscalation: handed_off call outcome routes to Maya", () => {
  const route = routeEscalation([], 90000, { callOutcome: "handed_off" });
  expect(route.routedTo).toBe("maya");
  expect(route.reason).toMatch(/no answer/);
});

test("routeEscalation: a bank-change flag routes to Dev", () => {
  const checks = runChecks({
    email: { body: "We've moved banks. Please pay invoice #9 ($900.00) to our new account.", fromAddress: "a@perimeterprostaffing.com", fromDomain: "perimeterprostaffing.com" },
    supplier: { key: "sup_perimeter_pro", name: "Perimeter Pro Staffing", domain: "perimeterprostaffing.com" },
    currentBankAccount: { bank: "US Bank", last4: "5509", verifiedBy: "onboarding" },
    pastPaidBankAccounts: [{ bank: "US Bank", last4: "9149" }],
    pastPaidAmounts: [444719],
    amountCents: 90000,
  });
  const route = routeEscalation(checks, 90000);
  expect(route.routedTo).toBe("dev");
  expect(route.reason).toMatch(/bank/i);
});

test("routeEscalation: a safe bill over $10k routes to Dev for approval", () => {
  const checks = runChecks({
    email: { body: "Please find attached invoice #10 in the amount of $11,000.00. Kindly remit to the account on file.", fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com" },
    supplier: stagecraftSupplier,
    currentBankAccount: stagecraftAccount,
    pastPaidBankAccounts: stagecraftPastAccounts,
    pastPaidAmounts: stagecraftPastAmounts,
    amountCents: 1100000,
  });
  const route = routeEscalation(checks, 1100000);
  expect(route.routedTo).toBe("dev");
  expect(route.reason).toMatch(/\$11,000\.00/);
});
