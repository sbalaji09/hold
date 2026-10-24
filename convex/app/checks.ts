// Pure bill checks + decision. Mirrors lib/data.ts's buildChecks rules and wording exactly
// (same regexes, same evidence phrasing), but takes plain inputs instead of hydrated fixture
// records so it can run at intake time, before a bill exists. runChecks/decide stay pure
// functions (no ctx) so they are trivial to unit test and reuse from Practice; checkValidator
// is just the convex/values shape of their output, for schema.ts and callers that store it.
import { v } from "convex/values";
import { companyFor, wholeDollars, type Company } from "../../lib/company.js";
import type { Check, Cite } from "../../lib/types.js";

// Supplier "new bank", an employee's "update my direct deposit", a closing party's "updated wire instructions".
const NEW_ACCOUNT_RE =
  /new (?:bank|account|routing)|updated account|moved banks|switched (?:to a new )?bank|changed bank|direct deposit|(?:new|updated|revised|corrected) wir(?:e|ing) instructions|dep[óo]sito directo|nueva cuenta|cambi(?:é|e|amos) de banco/i;
const RUSH_RE = /\b(urgent|asap|as soon as possible|today|expedite|right away|immediately|same[- ]day|before (?:tomorrow|close of business))\b/i;

function matchingLine(body: string, re: RegExp): string | undefined {
  const line = body.split(/\n+/).find((l) => re.test(l));
  return line?.trim();
}

function fmtMoney(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface LearnedRuleInput {
  text: string;
  /** Where the rule came from (plan-agent.md addendum §1), so the "Learned rule applies" and
   * suppressed-flag checks can cite the record it was saved from instead of a loose label. */
  sourceKind: string;
  sourceKey: string;
}

/** Cite's kind union is fixed to email/bill/supplier/call/payment, so a rule saved from a bill
 * cites that bill; anything else falls back to the supplier record. */
function ruleCite(rule: LearnedRuleInput, supplierKey: string): Cite {
  return rule.sourceKind === "bill" ? { kind: "bill", ref: rule.sourceKey } : { kind: "supplier", ref: supplierKey };
}

export interface CheckEmail {
  body: string;
  fromAddress: string;
  fromDomain: string;
}

export interface CheckSupplier {
  key: string;
  name: string;
  domain: string;
  /** From the Apify domain-age lookup. Only included in the evidence when provided. */
  domainRegisteredDays?: number;
}

export interface CheckBankAccount {
  bank: string;
  last4: string;
}

/** The account this bill will be paid from if it ends up "pay". Always the supplier's account on
 * file, never digits lifted straight out of the email (those only drive the NEW_ACCOUNT_RE text match). */
export interface CurrentBankAccount extends CheckBankAccount {
  verifiedBy: "onboarding" | "call+dev";
  /** True once a call confirmed a verifiedBy "call+dev" change (lib/data.ts's `call?.outcome === "confirmed"`). */
  confirmedByCall?: boolean;
}

export interface RunChecksInput {
  email: CheckEmail;
  supplier: CheckSupplier;
  /** The account this bill will be paid to (supplier's on-file account, not parsed from the email). */
  currentBankAccount: CurrentBankAccount;
  /** One entry per past *paid* bill from this supplier, same order/length as pastPaidAmounts. */
  pastPaidBankAccounts: CheckBankAccount[];
  /** Cents, one per past paid bill from this supplier. */
  pastPaidAmounts: number[];
  amountCents: number;
  styleMatch?: { matches: boolean; reasons: string[] };
  /** Rules the approver saved for this supplier (plan-agent.md addendum §1). Never relaxes a hard
   * limit: a rule naming this account's last four only passes a bank-change request when the
   * account was already verified by a confirmed call plus the approver (verifiedBy call+dev); the rule alone
   * never passes it. Any rule for the supplier also surfaces as its own info check. Omit for suppliers with no saved rules. */
  learnedRules?: LearnedRuleInput[];
  /** hold's playbook check (lib/fraudTechniques.ts techniqueCheck), built by the caller from
   * Claude's assessment of this email. Skipped when not supplied. */
  fraudTechnique?: Check;
  /** Whose words the evidence uses. Absent = Fogline. */
  company?: Company;
}

export function runChecks(input: RunChecksInput): Check[] {
  const { email, supplier, currentBankAccount, pastPaidBankAccounts, pastPaidAmounts, amountCents, styleMatch, learnedRules, fraudTechnique } = input;
  const co = input.company ?? companyFor(undefined);
  const us = co.name;
  const billWord = co.bill.one;
  const emailCite = { kind: "email" as const, ref: email.fromAddress };
  const priorPaidCount = pastPaidAmounts.length;
  const priorPaidSameAccount = pastPaidBankAccounts.filter(
    (a) => a.bank === currentBankAccount.bank && a.last4 === currentBankAccount.last4,
  );

  // 1. Bank account vs supplier history.
  let bankCheck: Check;
  const verified = currentBankAccount.verifiedBy === "call+dev" && currentBankAccount.confirmedByCall;
  const accountRule = (learnedRules ?? []).filter((r) => r.text.includes(currentBankAccount.last4)).pop();
  if (NEW_ACCOUNT_RE.test(email.body) && verified && accountRule) {
    // Already verified by a call and Dev, and a person saved a rule for this account: the same
    // change isn't asked about again. The rule alone never does this; the verification does.
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "pass",
      evidence: `${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4} was verified by call and your approval. Saved rule: ${accountRule.text}`,
      cite: ruleCite(accountRule, supplier.key),
    };
  } else if (NEW_ACCOUNT_RE.test(email.body)) {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "flag",
      evidence:
        priorPaidCount > 0
          ? `${us} has paid ${supplier.name} ${priorPaidCount} time${priorPaidCount === 1 ? "" : "s"}, always to ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4}. This email asks to change the account.`
          : `${us} has no payment history with ${supplier.name}. This email asks to pay a bank account different from the one on file, ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4}.`,
      quote: matchingLine(email.body, NEW_ACCOUNT_RE),
      cite: emailCite,
    };
  } else if (priorPaidCount > 0 && priorPaidSameAccount.length === 0) {
    if (currentBankAccount.verifiedBy === "call+dev" && currentBankAccount.confirmedByCall) {
      bankCheck = {
        id: "bank-account",
        label: "New bank account",
        state: "pass",
        evidence: `${us} verified the ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4} account by call; you approved the change.`,
        cite: { kind: "supplier", ref: supplier.key },
      };
    } else {
      bankCheck = {
        id: "bank-account",
        label: "New bank account",
        state: "flag",
        evidence: `This ${billWord} uses ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4}, which ${us} has not paid ${supplier.name} before.`,
        cite: emailCite,
      };
    }
  } else if (priorPaidCount === 0) {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "info",
      evidence: `This is ${co.owner} first ${billWord} for ${supplier.name}. The ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4} account was verified at onboarding.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  } else {
    bankCheck = {
      id: "bank-account",
      label: "New bank account",
      state: "pass",
      evidence: `${us} has paid ${supplier.name} ${priorPaidCount} times, always to ${currentBankAccount.bank} \u00b7\u00b7${currentBankAccount.last4}.`,
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
          evidence: `Email came from ${email.fromDomain}, matching the ${co.payee.one} record.`,
          cite: emailCite,
        }
      : {
          id: "domain",
          label: "Look-alike domain",
          state: "flag",
          evidence:
            `${co.owner} ${co.payee.one} record lists ${supplier.domain}. This email came from ${email.fromDomain}.` +
            (supplier.domainRegisteredDays !== undefined
              ? ` That domain was registered ${supplier.domainRegisteredDays} day${supplier.domainRegisteredDays === 1 ? "" : "s"} ago.`
              : ""),
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
        evidence: `Prior ${co.bill.many} for ${supplier.name} carried no same-day deadline. This one pushes for immediate payment.`,
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
  if (priorPaidCount === 0) {
    amountCheck = {
      id: "amount",
      label: "Amount vs history",
      state: "info",
      evidence: `This is ${co.owner} first ${billWord} for ${supplier.name}; there's no history to compare ${fmtMoney(amountCents)} against.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  } else {
    const min = Math.min(...pastPaidAmounts);
    const max = Math.max(...pastPaidAmounts);
    const unusual = amountCents > max * 1.5;
    amountCheck = {
      id: "amount",
      label: "Amount vs history",
      state: unusual ? "flag" : "pass",
      evidence: `${us} has paid ${supplier.name} ${priorPaidCount} times, from ${fmtMoney(min)} to ${fmtMoney(max)}. This ${billWord} asks for ${fmtMoney(amountCents)}.`,
      cite: { kind: "supplier", ref: supplier.key },
    };
  }

  const checks = [bankCheck, domainCheck, rushCheck, amountCheck];

  // Learned rule info check (plan-agent.md addendum §1): the most recently saved rule for this
  // supplier, cited back to its source. Informational only; the only decision a rule
  // can affect is the bank-account branch above, and only for an already call+dev-verified account.
  if (learnedRules && learnedRules.length > 0) {
    const latest = learnedRules[learnedRules.length - 1]!;
    checks.push({
      id: "learned-rule",
      label: "Learned rule applies",
      state: "info",
      evidence: latest.text,
      cite: ruleCite(latest, supplier.key),
    });
  }

  // 5. Writing style (contract #4, voice's styleMatch). Skipped entirely when not supplied.
  if (styleMatch) {
    checks.push({
      id: "writing-style",
      label: "Writing style",
      state: styleMatch.matches ? "pass" : "flag",
      evidence: styleMatch.matches
        ? `Writing style matches ${supplier.name}'s past emails.`
        : (styleMatch.reasons[0] ?? `Writing style doesn't match ${supplier.name}'s past emails.`),
      cite: emailCite,
    });
  }

  // 6. Fraud techniques: known ones from the playbook, and ones hold hasn't seen before.
  if (fraudTechnique) checks.push(fraudTechnique);

  return checks;
}

export type Decision = "pay" | "ask_dev" | "call";

/** Server-side limits (plan-agent.md step 4): safe + under the company's limit pays, safe + over
 * it asks the approver, anything flagged gets a check call. */
export function decide(checks: Check[], amountCents: number, company?: Company): Decision {
  if (checks.some((c) => c.state === "flag")) return "call";
  return amountCents >= (company ?? companyFor(undefined)).approvalLimitCents ? "ask_dev" : "pay";
}

export type EscalationRouting = { routedTo: "dev"; reason: string };

/**
 * Why an escalation needs you, in plain words (plan-agent.md addendum §2: "Sources
 * disagree…", never a score). A failed check, a bank change or a big payment always needs
 * your decision; a call that got no answer or dropped also needs you, since there's nothing
 * to approve yet, only a retry to arrange.
 */
export function routeEscalation(
  checks: Check[],
  amountCents: number,
  options: { callOutcome?: "confirmed" | "not_confirmed" | "handed_off" | "needs_review" | null; company?: Company } = {},
): EscalationRouting {
  const co = options.company ?? companyFor(undefined);
  if (options.callOutcome === "handed_off") {
    return { routedTo: "dev", reason: "The check call got no answer and the retry didn't connect either." };
  }
  const bankFlag = checks.find((c) => c.id === "bank-account" && c.state === "flag");
  if (bankFlag) return { routedTo: "dev", reason: `Bank change: ${bankFlag.evidence}` };
  const otherFlags = checks.filter((c) => c.state === "flag");
  if (otherFlags.length > 0) {
    return { routedTo: "dev", reason: otherFlags.map((c) => c.evidence).join(" ") };
  }
  if (options.callOutcome === "not_confirmed") {
    return { routedTo: "dev", reason: `The check call didn't confirm this ${co.bill.one}, so it's held until you decide.` };
  }
  if (amountCents < co.approvalLimitCents) {
    return { routedTo: "dev", reason: `This ${co.bill.one} needs your decision before anything is paid.` };
  }
  return { routedTo: "dev", reason: `${fmtMoney(amountCents)} is over hold's ${wholeDollars(co.approvalLimitCents)} limit, so it needs your approval.` };
}

/** Matches lib/types.ts's Check shape, for schema.ts and any caller storing runChecks's output. */
export const checkValidator = v.object({
  id: v.string(),
  label: v.string(),
  state: v.union(v.literal("pass"), v.literal("flag"), v.literal("info")),
  evidence: v.string(),
  quote: v.optional(v.string()),
  cite: v.object({
    kind: v.union(v.literal("email"), v.literal("bill"), v.literal("supplier"), v.literal("call"), v.literal("payment")),
    ref: v.string(),
  }),
});
