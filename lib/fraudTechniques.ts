// hold's fraud playbook and the pure rules of its self-improvement loop. No data access: Convex
// functions (convex/app/techniques.ts, convex/app/improve.ts) load the rows and apply the results.

import type { Check } from "./types";

export interface Technique {
  key: string;
  name: string;
  howItWorks: string;
  signals: string[];
  example: string;
}

/** What Claude found when it read one email against the playbook. */
export interface TechniqueAssessment {
  /** Known techniques the email uses, each with the words that show it. */
  matches: { techniqueKey: string; quote: string; why: string }[];
  /** Payment fraud that fits none of the known techniques: how a brand-new technique is caught. */
  novel: { suspicious: boolean; name: string; quote: string; why: string };
}

/**
 * The playbook hold starts with: common business-email-compromise techniques. Everything else it
 * learns (convex/app/improve.ts) is added next to these and can be reverted.
 */
export const SEED_PLAYBOOK: Omit<Technique, "key">[] = [
  {
    name: "Bank change request",
    howItWorks: "The supplier's mailbox (often hacked) or an impersonator asks Fogline to pay a new or updated bank account.",
    signals: ["new, updated or changed bank details", "\"we moved banks\", \"please update your records\"", "an account Fogline has never paid"],
    example: "Please note our banking has changed. Kindly remit this and future invoices to the new account below.",
  },
  {
    name: "Partial bank change",
    howItWorks: "Only the routing number, bank name or account holder changes, so the account looks familiar at a glance.",
    signals: ["same account number with a different routing number or bank", "\"our bank merged\" or \"new routing number\""],
    example: "Our bank was acquired, so the routing number is now 084106768. The account number stays the same.",
  },
  {
    name: "Look-alike sender domain",
    howItWorks: "The email comes from a domain that imitates the supplier's real one.",
    signals: ["a sender domain one letter off, with an extra word, or on a different extension"],
    example: "From: accounts@stagecraft-rigging.co instead of stagecraftrigging.com",
  },
  {
    name: "Executive impersonation",
    howItWorks: "Someone posing as a Fogline or supplier executive pushes a payment outside the normal process.",
    signals: ["\"I'm in a meeting, just get this paid\"", "an executive asking accounts directly to skip approval"],
    example: "Dev here. I'm boarding a flight, please wire this today and I'll sign off when I land.",
  },
  {
    name: "Thread hijack",
    howItWorks: "A reply in a real, older email thread swaps in new payment details so it looks like an ongoing conversation.",
    signals: ["\"RE:\" on an old invoice thread with new payment instructions", "a quoted genuine email above changed bank details"],
    example: "RE: Invoice 4138. Following up on the below, please use our updated account for this one.",
  },
  {
    name: "Third-party remittance",
    howItWorks: "The supplier asks to be paid through someone else: a factoring company, parent company, agent or personal account.",
    signals: ["pay our factoring company, parent company, collections agent or an individual", "the account holder isn't the supplier"],
    example: "We've assigned our receivables to Harbor Capital. Please remit to their account from now on.",
  },
  {
    name: "Payment link or portal",
    howItWorks: "Instead of bank details on file, the email sends a link, QR code or new portal to pay through.",
    signals: ["\"pay securely at this link\"", "a QR code or a new payment portal", "card payment instead of the usual transfer"],
    example: "We've moved to online billing. Please pay invoice 4502 through our secure portal: pay-stagecraft.com/inv4502",
  },
  {
    name: "Unusual payment method",
    howItWorks: "The supplier asks for gift cards, crypto, or a wire to an overseas or personal account.",
    signals: ["gift cards, crypto or a wallet address", "an overseas account for a local supplier"],
    example: "For faster settlement this month, please send USDC to the wallet below.",
  },
  {
    name: "Contact or callback-number change",
    howItWorks: "The email changes who to contact or which number to call to verify, so a check call reaches the scammer.",
    signals: ["\"call our new number to confirm\"", "a new accounts contact or email for remittances"],
    example: "Our office line is down; to confirm the new details please call Ana on +1 628 555 0143.",
  },
  {
    name: "Secrecy or no-call pressure",
    howItWorks: "The email asks Fogline not to call, to keep it confidential, or to rely on email only.",
    signals: ["\"don't call, phones are down\"", "\"keep this between us\"", "\"email only for this one\""],
    example: "Please don't call the office about this, the team is at the venue. Email is best.",
  },
  {
    name: "Fake or duplicate invoice",
    howItWorks: "An invoice for work Fogline never ordered, or a copy of one already paid with new payment details.",
    signals: ["an invoice number Fogline already paid", "work or goods with no matching order or history"],
    example: "Attached is invoice 4471 for the main-stage truss. Please pay to the account below.",
  },
];

/** The bill-page check for one assessment. Stricter wording than the other checks: it names what it saw. */
export function techniqueCheck(a: TechniqueAssessment, playbook: Technique[], emailRef: string): Check {
  const cite = { kind: "email" as const, ref: emailRef };
  const named = a.matches
    .map((m) => ({ ...m, technique: playbook.find((t) => t.key === m.techniqueKey) }))
    .filter((m) => m.technique);
  if (named.length > 0) {
    const [first, ...rest] = named;
    const also = rest.length ? ` Also looks like: ${rest.map((m) => m.technique!.name).join(", ")}.` : "";
    return {
      id: "fraud-technique",
      label: "Fraud technique",
      state: "flag",
      evidence: `Matches "${first!.technique!.name}". ${sentence(first!.why)}${also}`,
      quote: first!.quote || undefined,
      cite,
    };
  }
  if (a.novel.suspicious) {
    return {
      id: "fraud-technique",
      label: "Fraud technique",
      state: "flag",
      evidence: `Looks like a payment scam hold hasn't seen before (${a.novel.name}). ${sentence(a.novel.why)}`,
      quote: a.novel.quote || undefined,
      cite,
    };
  }
  return {
    id: "fraud-technique",
    label: "Fraud technique",
    state: "pass",
    evidence: `Doesn't match any of the ${playbook.length} fraud techniques hold knows, and nothing else about the payment request looks off.`,
    cite,
  };
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

// ---------- replay scoring (Hone: promote only what fixes the case and breaks nothing) ----------

export type Verdict = "flag" | "pass";

export interface ReplayCase {
  label: string;
  billKey?: string;
  expected: Verdict;
  before: Verdict;
  after: Verdict;
  /** The case that triggered this improvement. */
  trigger?: boolean;
}

export interface ReplayScore {
  fixed: boolean;
  /** Cases the old playbook got right and the new one gets wrong. */
  regressions: ReplayCase[];
}

export function scoreReplay(cases: ReplayCase[]): ReplayScore {
  const trigger = cases.find((c) => c.trigger);
  return {
    fixed: trigger ? trigger.after === trigger.expected : false,
    regressions: cases.filter((c) => !c.trigger && c.before === c.expected && c.after !== c.expected),
  };
}

export type TriggerKind = "missed_scam" | "false_alarm" | "taught";

/**
 * What happens to a proposal after replay. Tightening (from a miss or a person teaching hold) goes
 * live on its own; loosening (from a false alarm) always waits for Dev, because a looser playbook
 * is how a scam gets paid.
 */
export function promotion(kind: TriggerKind, score: ReplayScore): "promote" | "needs_approval" | "retry" {
  if (!score.fixed || score.regressions.length > 0) return "retry";
  return kind === "false_alarm" ? "needs_approval" : "promote";
}

/** One line for the Practice screen and the Activity log. */
export function replaySummary(cases: ReplayCase[], score: ReplayScore): string {
  const others = cases.filter((c) => !c.trigger).length;
  const fixedPart = score.fixed ? "handles the new case" : "still gets the new case wrong";
  const regressPart =
    score.regressions.length === 0
      ? "no regressions"
      : `${score.regressions.length} regression${score.regressions.length === 1 ? "" : "s"} (${score.regressions.map((r) => r.label).join(", ")})`;
  return `Replayed on ${others} past case${others === 1 ? "" : "s"} plus the new one: ${fixedPart}, ${regressPart}.`;
}
