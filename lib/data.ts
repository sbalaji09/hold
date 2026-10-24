// Data source switch: when NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) is set, every
// exported function below reads through Convex's hydrated queries
// (convex/app/queries.ts, which already map rows onto these lib/types.ts shapes).
// With neither set, it falls back to data/fogline.json so the app still runs with
// nothing configured. Exported names/return types never change either way, so
// screens don't know or care which source answered.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache as perRender } from "react";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { routeEscalation } from "../convex/app/checks";
import { api } from "../convex/_generated/api";
import { companyFor, type Company } from "./company";
import type {
  ActivityEntry,
  Approval,
  ApprovalKind,
  BackgroundCheck,
  BankAccount,
  Bill,
  BillListFilter,
  Call,
  Check,
  Email,
  LearnedRule,
  Payment,
  Settings,
  Supplier,
} from "./types";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

// The reads below are wrapped in React's cache(): within one server render the sidebar and the
// page share a single Convex fetch per query instead of each making their own.

function convexOpts() {
  return CONVEX_URL ? { url: CONVEX_URL } : undefined;
}

const TEN_THOUSAND_CENTS = 1_000_000;

interface RawFogline {
  suppliers: Supplier[];
  bankAccounts: BankAccount[];
  bills: Array<Omit<Bill, "supplier" | "bankAccount" | "email" | "payment" | "call" | "checks">>;
  emails: Email[];
  payments: Payment[];
  calls: Call[];
  plantedScams: Array<{ key: string; billKey: string; kind: string; description: string; checksThatShouldFire: string[] }>;
}

let cache: RawFogline | null = null;

async function load(): Promise<RawFogline> {
  if (cache) return cache;
  const file = await readFile(path.join(process.cwd(), "data", "fogline.json"), "utf-8");
  const raw = JSON.parse(file) as RawFogline;
  // Convex mode's toBankAccount (convex/app/queries.ts) never selects routingNumber/accountNumber
  // onto the client-facing BankAccount shape; strip them here too so the JSON fallback matches.
  // generate.ts and convex/app/increase.ts (the real Increase payout) read the full fogline.json /
  // bankAccounts table directly, not through this fallback, so they still see the full numbers.
  raw.bankAccounts = raw.bankAccounts.map(({ routingNumber: _routingNumber, accountNumber: _accountNumber, ...rest }) => rest);
  cache = raw;
  return cache;
}

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const NEW_ACCOUNT_RE = /new (?:bank|account)|updated account|moved banks|switched (?:to a new )?bank|changed bank/i;
const RUSH_RE = /\b(urgent|asap|as soon as possible|today|expedite|right away|immediately|same[- ]day|before (?:tomorrow|close of business))\b/i;

function matchingLine(body: string, re: RegExp): string | undefined {
  const line = body.split(/\n+/).find((l) => re.test(l));
  return line?.trim();
}

function buildChecks(
  bill: RawFogline["bills"][number],
  supplier: Supplier,
  bankAccount: BankAccount,
  email: Email,
  supplierBills: RawFogline["bills"],
  call: Call | null,
): Check[] {
  const priorBills = supplierBills.filter((b) => b.key !== bill.key);
  const priorPaid = priorBills.filter((b) => b.status === "Paid");
  const priorPaidSameAccount = priorPaid.filter((b) => b.bankAccountKey === bill.bankAccountKey);
  const emailCite = { kind: "email" as const, ref: email.key };

  // 1. Bank account vs supplier history.
  let bankCheck: Check;
  if (NEW_ACCOUNT_RE.test(email.body)) {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "flag",
      evidence:
        priorPaid.length > 0
          ? `Fogline has paid ${supplier.name} ${priorPaid.length} time${priorPaid.length === 1 ? "" : "s"}, always to ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4}. This email asks to change the account.`
          : `Fogline has no payment history with ${supplier.name}. This email asks to pay a bank account different from the one on file, ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4}.`,
      quote: matchingLine(email.body, NEW_ACCOUNT_RE),
      cite: emailCite,
    };
  } else if (priorPaid.length > 0 && priorPaidSameAccount.length === 0) {
    if (bankAccount.verifiedBy === "call+dev" && call?.outcome === "confirmed") {
      bankCheck = {
        id: "bank-account",
        label: "New bank account",
        state: "pass",
        evidence: `Fogline verified the ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4} account by call on ${fmtDate(call.startedAt)}; Dev approved the change.`,
        cite: { kind: "call", ref: call.key },
      };
    } else {
      bankCheck = {
        id: "bank-account",
        label: "New bank account",
        state: "flag",
        evidence: `This bill uses ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4}, which Fogline has not paid ${supplier.name} before.`,
        cite: emailCite,
      };
    }
  } else if (priorPaid.length === 0) {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "info",
      evidence: `This is Fogline's first bill from ${supplier.name}. The ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4} account was verified at onboarding.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  } else {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "pass",
      evidence: `Fogline has paid ${supplier.name} ${priorPaid.length} times, always to ${bankAccount.bank} \u00b7\u00b7${bankAccount.last4}.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  }

  // 2. Look-alike domain.
  const domainCheck: Check =
    email.fromDomain === supplier.domain
      ? {
          id: "domain",
          label: "Sender domain",
          state: "pass",
          evidence: `Email came from ${email.fromDomain}, matching the supplier record.`,
          cite: emailCite,
        }
      : {
          id: "domain",
          label: "Look-alike domain",
          state: "flag",
          evidence: `Fogline's supplier record lists ${supplier.domain}. This email came from ${email.fromDomain}.`,
          quote: email.fromAddress,
          cite: emailCite,
        };

  // 3. Rush language.
  const rushLine = matchingLine(email.body, RUSH_RE);
  const rushCheck: Check = rushLine
    ? {
        id: "rush-language",
        label: "Rush language",
        state: "flag",
        evidence: `Prior invoices from ${supplier.name} carried no same-day deadline. This one pushes for immediate payment.`,
        quote: rushLine,
        cite: emailCite,
      }
    : {
        id: "rush-language",
        label: "Rush language",
        state: "pass",
        evidence: "No pressure to pay today or skip the normal process.",
        cite: emailCite,
      };

  // 4. Unusual amount vs supplier's past amounts.
  let amountCheck: Check;
  if (priorPaid.length === 0) {
    amountCheck = {
      id: "amount",
      label: "Amount vs history",
      state: "info",
      evidence: `This is Fogline's first bill from ${supplier.name}; there's no history to compare ${fmtMoney(bill.amountCents)} against.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  } else {
    const amounts = priorPaid.map((b) => b.amountCents);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const unusual = bill.amountCents > max * 1.5;
    amountCheck = {
      id: "amount",
      label: "Amount vs history",
      state: unusual ? "flag" : "pass",
      evidence: `Fogline has paid ${supplier.name} ${priorPaid.length} times, from ${fmtMoney(min)} to ${fmtMoney(max)}. This bill asks for ${fmtMoney(bill.amountCents)}.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  }

  return [bankCheck, domainCheck, rushCheck, amountCheck];
}

async function hydrateBill(raw: RawFogline["bills"][number], d: RawFogline): Promise<Bill> {
  const supplier = d.suppliers.find((s) => s.key === raw.supplierKey);
  const bankAccount = d.bankAccounts.find((b) => b.key === raw.bankAccountKey);
  const email = d.emails.find((e) => e.key === raw.emailKey);
  if (!supplier || !bankAccount || !email) {
    throw new Error(`Bill ${raw.key} is missing a referenced record`);
  }
  const payment = d.payments.find((p) => p.billKey === raw.key) ?? null;
  const call = d.calls.find((c) => c.billKey === raw.key) ?? null;
  const supplierBills = d.bills.filter((b) => b.supplierKey === raw.supplierKey);
  const checks = buildChecks(raw, supplier, bankAccount, email, supplierBills, call);
  return { ...raw, supplier, bankAccount, email, payment, call, checks };
}

export const listBills = perRender(async function listBills(filter?: BillListFilter): Promise<Bill[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listBills, { status: filter?.status }, convexOpts());
  }
  const d = await load();
  const raws = filter?.status ? d.bills.filter((b) => b.status === filter.status) : d.bills;
  const bills = await Promise.all(raws.map((raw) => hydrateBill(raw, d)));
  return bills.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
});

export async function getBill(key: string): Promise<Bill | null> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.getBill, { key }, convexOpts());
  }
  const d = await load();
  const raw = d.bills.find((b) => b.key === key);
  if (!raw) return null;
  return hydrateBill(raw, d);
}

export async function getSupplier(key: string): Promise<Supplier | null> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.getSupplier, { key }, convexOpts());
  }
  const d = await load();
  return d.suppliers.find((s) => s.key === key) ?? null;
}

export const listSuppliers = perRender(async function listSuppliers(): Promise<Supplier[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listSuppliers, {}, convexOpts());
  }
  const d = await load();
  return [...d.suppliers].sort((a, b) => a.name.localeCompare(b.name));
});

/** Supplier rows with an open (not Paid/Scheduled) bill count, for the Suppliers overview. */
export async function listSupplierSummaries(): Promise<Array<Supplier & { openItems: number }>> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listSupplierSummaries, {}, convexOpts());
  }
  const d = await load();
  const openBySupplier = new Map<string, number>();
  for (const b of d.bills) {
    if (b.status === "Paid" || b.status === "Scheduled") continue;
    openBySupplier.set(b.supplierKey, (openBySupplier.get(b.supplierKey) ?? 0) + 1);
  }
  return [...d.suppliers]
    .map((s) => ({ ...s, openItems: openBySupplier.get(s.key) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listBankAccountsForSupplier(key: string): Promise<BankAccount[]> {
  if (CONVEX_URL) return fetchQuery(api.app.queries.listBankAccountsForSupplier, { supplierKey: key }, convexOpts());
  const d = await load();
  return d.bankAccounts
    .filter((b) => b.supplierKey === key)
    .sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
}

export async function listBillsForSupplier(key: string): Promise<Bill[]> {
  const bills = await listBills();
  return bills.filter((b) => b.supplier.key === key);
}

export async function listCallsForSupplier(key: string): Promise<Call[]> {
  if (CONVEX_URL) return fetchQuery(api.app.queries.listCallsForSupplier, { supplierKey: key }, convexOpts());
  const d = await load();
  return d.calls.filter((c) => c.supplierKey === key).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function isApprovable(bill: RawFogline["bills"][number]): boolean {
  if (bill.status === "Held" || bill.status === "Needs you") return true;
  return bill.amountCents > TEN_THOUSAND_CENTS && bill.status !== "Paid";
}

function approvalKind(bill: Bill): ApprovalKind {
  if (bill.checks.find((c) => c.id === "bank-account")?.state === "flag") return "bank_change";
  if (bill.status === "Held") return "held_payment";
  return "big_payment";
}

function recommendation(bill: Bill): string {
  const flagged = bill.checks.filter((c) => c.state === "flag");
  if (flagged.length > 0) {
    return `Hold this payment. ${flagged.map((c) => c.evidence).join(" ")}`;
  }
  return `Pay ${fmtMoney(bill.amountCents)} to ${bill.bankAccount.bank} \u00b7\u00b7${bill.bankAccount.last4}. All checks passed; this is over Callback's $10,000 limit, so Dev needs to approve it.`;
}

/** Playbook changes waiting for a person's sign-off (shown on Approvals). Fraud changes need Dev; inbox ones, Maya or Dev. Convex only. */
export const listPlaybookApprovals = perRender(async function listPlaybookApprovals(): Promise<Array<{ key: string; job: "fraud" | "triage"; name: string }>> {
  if (!CONVEX_URL) return [];
  const { improvements } = await fetchQuery(api.app.techniques.list, {}, convexOpts());
  return improvements
    .filter((i) => i.status === "needs_approval")
    .map((i) => ({ key: i.key, job: i.job ?? "fraud", name: i.proposal?.name ?? "A change to the playbook" }));
});

export async function countPlaybookApprovals(): Promise<number> {
  return (await listPlaybookApprovals()).length;
}

export const listApprovals = perRender(async function listApprovals(): Promise<Approval[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listApprovals, {}, convexOpts());
  }
  const d = await load();
  const raws = d.bills.filter(isApprovable);
  const bills = await Promise.all(raws.map((raw) => hydrateBill(raw, d)));
  return bills
    .map((bill) => {
      const route = routeEscalation(bill.checks, bill.amountCents, {
        callOutcome: bill.call?.outcome ?? null,
      });
      return {
        key: "appr_" + bill.key,
        billKey: bill.key,
        bill,
        kind: approvalKind(bill),
        status: "pending" as const,
        recommendation: recommendation(bill),
        routedTo: route.routedTo,
        reason: route.reason,
        thread: [],
      };
    })
    .sort((a, b) => (a.bill.receivedAt < b.bill.receivedAt ? 1 : -1));
});

export type Messages = FunctionReturnType<typeof api.app.triage.messages>;
export type Message = Messages["open"][number];

/** Supplier emails hold sorted as messages (convex/app/triage.ts). The JSON fallback has none. */
export const listMessages = perRender(async function listMessages(): Promise<Messages> {
  if (CONVEX_URL) return fetchQuery(api.app.triage.messages, {}, convexOpts());
  return { open: [], done: [], filed: [] };
});

export const listPayments = perRender(async function listPayments(): Promise<Array<Payment & { bill: Bill }>> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listPayments, {}, convexOpts());
  }
  const d = await load();
  const out = await Promise.all(
    d.payments.map(async (payment) => {
      const raw = d.bills.find((b) => b.key === payment.billKey);
      if (!raw) throw new Error(`Payment ${payment.key} references a missing bill`);
      const bill = await hydrateBill(raw, d);
      return { ...payment, bill };
    }),
  );
  return out.sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1));
});

export const listActivity = perRender(async function listActivity(): Promise<ActivityEntry[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.listActivity, {}, convexOpts());
  }
  const d = await load();
  const entries: ActivityEntry[] = [];

  for (const payment of d.payments) {
    const bill = d.bills.find((b) => b.key === payment.billKey);
    const bank = bill ? d.bankAccounts.find((a) => a.key === payment.bankAccountKey) : undefined;
    entries.push({
      key: "act_pay_" + payment.key,
      actor: "callback",
      what: `paid ${fmtMoney(payment.amountCents)} to ${bank ? bank.bank + " \u00b7\u00b7" + bank.last4 : "the account on file"}.`,
      why: "Amount was under $10,000 and every check passed.",
      refKind: "bill",
      refKey: payment.billKey,
      at: payment.paidAt,
    });
  }

  for (const raw of d.bills.filter((b) => b.status === "Held")) {
    const supplier = d.suppliers.find((s) => s.key === raw.supplierKey);
    entries.push({
      key: "act_hold_" + raw.key,
      actor: "callback",
      what: `held ${fmtMoney(raw.amountCents)} to ${supplier?.name ?? raw.supplierKey}.`,
      why: "A check on this bill didn't pass.",
      refKind: "bill",
      refKey: raw.key,
      at: raw.receivedAt,
    });
  }

  for (const call of d.calls) {
    const supplier = d.suppliers.find((s) => s.key === call.supplierKey);
    entries.push({
      key: "act_call_" + call.key,
      actor: "callback",
      what: `called ${supplier?.name ?? call.supplierKey} to verify a bill.`,
      why: call.summary,
      refKind: "bill",
      refKey: call.billKey,
      at: call.startedAt,
    });
  }

  for (const bank of d.bankAccounts.filter((b) => b.verifiedBy === "call+dev")) {
    const supplier = d.suppliers.find((s) => s.key === bank.supplierKey);
    const call = d.calls.find((c) => c.supplierKey === bank.supplierKey && c.outcome === "confirmed");
    entries.push({
      key: "act_dev_" + bank.key,
      actor: "dev",
      what: `approved the new ${bank.bank} \u00b7\u00b7${bank.last4} account for ${supplier?.name ?? bank.supplierKey}.`,
      why: call ? `Confirmed by call on ${fmtDate(call.startedAt)}.` : "Confirmed by call.",
      refKind: "bankAccount",
      refKey: bank.key,
      at: bank.addedAt,
    });
  }

  return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
});

export async function listChecksForSupplier(key: string): Promise<BackgroundCheck[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.background.listChecksForSupplier, { supplierKey: key }, convexOpts());
  }
  return [];
}

export async function listChecksForBill(key: string): Promise<BackgroundCheck[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.background.listChecksForBill, { billKey: key }, convexOpts());
  }
  return [];
}

/** Rules Maya or Dev saved for a supplier (plan-agent.md addendum §1). The JSON fixture has
 * no learned-rules table, so the fallback is always empty; nothing to learn from without Convex. */
export async function listRules(supplierKey: string): Promise<LearnedRule[]> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.rules.listRules, { supplierKey }, convexOpts());
  }
  return [];
}

/** The global Watch only setting (Payments page toggle). The JSON fixture has no settings
 * table, so the fallback always reports it off and read-only. */
export const getSettings = perRender(async function getSettings(): Promise<Settings> {
  if (CONVEX_URL) {
    return fetchQuery(api.app.queries.getSettings, {}, convexOpts());
  }
  return { watchOnly: false };
});

/** Who hold works for (lib/company.ts). The JSON fixture is always Fogline. */
export const getCompany = perRender(async function getCompany(): Promise<Company> {
  if (CONVEX_URL) return fetchQuery(api.app.company.current, {}, convexOpts());
  return companyFor(undefined);
});
