// Inbox triage, the second job on hold's loop: sort every supplier email by kind and send it where
// it belongs. Pure: Convex functions (convex/app/triage.ts) load the playbook and apply the result.

export type Route = "bill" | "to_maya" | "file";

export const ROUTE_WORDS: Record<Route, string> = {
  bill: "a bill to check and pay",
  to_maya: "a message for Maya",
  file: "filed on the supplier record",
};

export interface EmailKind {
  key: string;
  name: string;
  howItWorks: string;
  signals: string[];
  example: string;
  route: Route;
}

/** What hold starts out knowing about supplier email. Everything else it learns from Maya. */
export const SEED_EMAIL_KINDS: Omit<EmailKind, "key">[] = [
  {
    name: "Invoice",
    route: "bill",
    howItWorks: "A supplier sends a bill for goods or services and asks Fogline to pay it.",
    signals: ["an invoice number with an amount due", "\"please find attached invoice\"", "\"kindly remit\""],
    example: "Please find attached invoice 4139 for rigging crew labor, due November 15.",
  },
  {
    name: "Payment reminder",
    route: "to_maya",
    howItWorks: "A follow-up about an invoice already sent. It is not a new bill, so paying it again would pay twice.",
    signals: ["\"friendly reminder\"", "\"following up on invoice\"", "\"past due\" about an existing invoice"],
    example: "Just a friendly reminder that invoice 4138 is due next Friday.",
  },
  {
    name: "Question for accounts",
    route: "to_maya",
    howItWorks: "The supplier asks something a person should answer: payment status, a missing remittance, a form.",
    signals: ["\"when will we be paid\"", "\"did you receive\"", "asks Fogline to reply or send something"],
    example: "Can you let us know when the October invoice will be paid?",
  },
  {
    name: "Schedule or logistics update",
    route: "to_maya",
    howItWorks: "Load-in times, crew changes, deliveries and site plans: operations news, not money.",
    signals: ["load-in or delivery times", "crew or site changes", "\"Re: schedule\""],
    example: "Load-in for the main stage moves to 6am Thursday; the crew will arrive at gate C.",
  },
  {
    name: "Sign-off request",
    route: "to_maya",
    howItWorks: "The supplier needs Fogline to approve or sign something: a layout, a quote, a change order.",
    signals: ["\"please sign off\"", "\"needs your approval\"", "a quote or change order to accept"],
    example: "Attached is the final main-stage layout. Please sign off by Monday so we can build.",
  },
  {
    name: "Document for the file",
    route: "file",
    howItWorks: "Certificates, insurance, W-9s, licences and safety paperwork the supplier keeps current.",
    signals: ["a certificate or insurance document", "a W-9 or tax form", "\"for your records\""],
    example: "Attached is our updated certificate of insurance for your records.",
  },
  {
    name: "Newsletter or announcement",
    route: "file",
    howItWorks: "General news from the supplier sent to all its customers.",
    signals: ["a newsletter or product announcement", "an unsubscribe link"],
    example: "Our autumn newsletter: new truss systems and our holiday hours.",
  },
];

/** Supplier emails with the right route, the replay set for triage changes. */
export const SEED_PRACTICE_EMAILS: { kind: string; expected: Route; text: string }[] = [
  { kind: "Invoice", expected: "bill", text: "Hi team, please find attached invoice #4140 for rigging crew labor, $5,230.00, due November 20. Kindly remit to the account on file. Thanks, Rosa" },
  { kind: "Invoice", expected: "bill", text: "Hello, invoice #2210 for the staff meal service on October 18 is attached. Total $680.00. Thanks, Haruto" },
  { kind: "Payment reminder", expected: "to_maya", text: "Hi team, just a friendly reminder that invoice #4138 for the stage deck rental is due next Friday. Thanks, Rosa" },
  { kind: "Question for accounts", expected: "to_maya", text: "Hi, did you receive our remittance details form? We haven't seen payment for October yet. Thanks, Ellis" },
  { kind: "Schedule or logistics update", expected: "to_maya", text: "Re: load-in schedule. The crew will now arrive at 6am Thursday at gate C instead of Wednesday afternoon. Rosa" },
  { kind: "Sign-off request", expected: "to_maya", text: "Re: main-stage layout sign-off. Attached is the final layout; please approve by Monday so we can start the build. Rosa" },
  { kind: "Document for the file", expected: "file", text: "Truss inspection certificate. Attached is this year's load test certificate for the main-stage truss, for your records. Rosa" },
  { kind: "Document for the file", expected: "file", text: "Hi, here is our updated certificate of insurance, valid through next September. Best, Diego" },
  { kind: "Newsletter or announcement", expected: "file", text: "The Fog City Ramen autumn newsletter: new menu items and our holiday hours. Unsubscribe here." },
];

/** What triage made of one email. kindKey is empty when it fits no kind hold knows. */
export interface TriageJudgment {
  kindKey: string;
  why: string;
  quote: string;
}

/**
 * Where the email actually goes. Triage can never be how a scam slips past: anything the fraud
 * check flags, or that names an amount, stays in front of a person or in the bill checks.
 */
export function routeEmail(
  judged: TriageJudgment,
  kinds: EmailKind[],
  facts: { hasAmount: boolean; fraudFlagged: boolean },
): { route: Route; kindKey?: string; kindName: string; why: string } {
  const kind = kinds.find((k) => k.key === judged.kindKey);
  const kindName = kind?.name ?? "Unknown kind";
  const base = { kindKey: kind?.key, kindName };
  if (facts.fraudFlagged) return { ...base, route: "bill", why: "hold's fraud check flagged it, so it goes through the bill checks and a check call." };
  if (!kind) return { ...base, route: "to_maya", why: "It doesn't match any kind of email hold knows yet, so Maya decides." };
  if (kind.route === "bill" && !facts.hasAmount) return { ...base, route: "to_maya", why: `It looks like an ${kind.name.toLowerCase()} but hold couldn't find an amount, so Maya checks it.` };
  if (kind.route === "file" && facts.hasAmount) return { ...base, route: "to_maya", why: "It mentions an amount, so a person looks at it instead of filing it." };
  return { ...base, route: kind.route, why: sentence(judged.why) };
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
