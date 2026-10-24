// Plain words for the Practice screen's "What hold has learned" section: who or what started a
// playbook change, what state it is in, and where a technique came from.
import type { Doc } from "@/convex/_generated/dataModel";
import type { BillStatus } from "@/components/callback";

export type Improvement = Doc<"improvements">;
export type FraudTechnique = Doc<"fraudTechniques">;

export const PERSON_NAME = { maya: "Maya Lin", dev: "Dev Okafor" } as const;

/** What a bill is called on screen, given whatever names are known for it. */
export function billRef(billKey: string | undefined, names: Record<string, string>): string {
  if (!billKey) return "a bill";
  return names[billKey] ?? "a bill";
}

/** "Email", "Phone" or "Email and phone". A technique with no channel is an email one. */
export function channelLabel(channel: FraudTechnique["channel"]): string {
  return channel === "phone" ? "Phone" : channel === "both" ? "Email and phone" : "Email";
}

/** Call refs: a Practice call key ("pcall_...") or an inbound call id ("in_..."), as convex/app/techniques.ts writes them. */
export const isPracticeCall = (ref: string | undefined): ref is string => !!ref?.startsWith("pcall_");
export const isInboundCall = (ref: string | undefined): ref is string => !!ref?.startsWith("in_");

/**
 * The headline for one improvement, e.g. "Missed scam on INV-4502 · Stagecraft Rigging Co.".
 * `names` maps bill keys, inbound call ids (to the caller's number) and Practice call keys (to their kind).
 */
export function triggerTitle(trigger: Improvement["trigger"], names: Record<string, string>): string {
  if (trigger.kind === "taught") return "A new technique to learn";
  const call = trigger.callId;
  if (isPracticeCall(call)) return `Practice call judged wrong: ${names[call] ?? "a scripted call"}`;
  if (call) {
    const from = names[call] ? `from ${names[call]}` : "to the phone line";
    return trigger.kind === "missed_scam" ? `Scam call ${from}` : `Call wrongly flagged ${from}`;
  }
  const ref = billRef(trigger.billKey, names);
  return trigger.kind === "missed_scam" ? `Missed scam on ${ref}` : `False alarm on ${ref}`;
}

/** Who raised it: hold itself (a Practice run, a false alarm) or a person. */
export function triggerBy(trigger: Improvement["trigger"]): { person: string | null; text: string } {
  if (trigger.by !== "callback") return { person: PERSON_NAME[trigger.by], text: trigger.kind === "taught" ? "Taught by" : "Reported by" };
  // hold only raises a call on its own when a Practice run judged it wrong.
  return { person: null, text: trigger.kind === "missed_scam" || trigger.callId ? "Found in a Practice run" : "Found by hold" };
}

export interface RecordLink {
  href: string;
  label: string;
}

/** Where the bill or call behind a change lives: a bill page, the Phone line, or the Practice call ledger. */
export function recordLink(ref: string | undefined): RecordLink | null {
  if (!ref) return null;
  if (isPracticeCall(ref)) return { href: `#${ref}`, label: "The Practice call" };
  if (isInboundCall(ref)) return { href: `/phone?call=${encodeURIComponent(ref)}`, label: "Open the call" };
  return { href: `/bills/${encodeURIComponent(ref)}`, label: "Open the bill" };
}

export interface ImprovementMark {
  /** The StatusMark colour to borrow, or null for a settled grey mark with a cross. */
  mark: BillStatus | null;
  label: string;
}

export const IMPROVEMENT_MARK: Record<Improvement["status"], ImprovementMark> = {
  proposing: { mark: "checking", label: "Learning" },
  replaying: { mark: "checking", label: "Replaying" },
  promoted: { mark: "paid", label: "Live" },
  needs_approval: { mark: "needs-you", label: "Waiting for Dev" },
  rejected: { mark: null, label: "Rejected" },
  declined: { mark: null, label: "Declined" },
  reverted: { mark: null, label: "Reverted" },
};

/** The in-progress line while hold is still working on a change. */
export function progressLine(impr: Improvement): string | null {
  if (impr.status === "proposing") return "Learning… writing a change to the playbook";
  if (impr.status !== "replaying") return null;
  // The case count is only known after the first replay, so a retry can name it.
  const n = impr.replay?.cases.length;
  return n ? `Learning… replaying ${n} past cases again` : "Learning… replaying past cases";
}

/** Where a technique in the playbook came from, and the bill or call to link to if there is one. */
export function techniqueSource(
  t: FraudTechnique,
  improvements: Improvement[],
  names: Record<string, string>,
): { text: string; person: string | null; link: RecordLink | null } {
  if (t.sourceKind === "seed") return { text: "Starting playbook", person: null, link: null };
  if (t.sourceKind === "taught") {
    const by = improvements.find((i) => i.key === t.improvementKey)?.trigger.by;
    return by && by !== "callback" ? { text: "Taught by", person: PERSON_NAME[by], link: null } : { text: "Taught to hold", person: null, link: null };
  }
  const ref = t.sourceRef;
  const link = recordLink(ref);
  if (isPracticeCall(ref)) return { text: `Learned from the Practice call \u201c${names[ref] ?? "a scripted call"}\u201d`, person: null, link };
  if (isInboundCall(ref)) {
    const from = names[ref] ? ` from ${names[ref]}` : "";
    return { text: t.sourceKind === "missed_scam" ? `Learned from a scam call${from}` : `Learned from a call wrongly flagged${from}`, person: null, link };
  }
  const what = t.sourceKind === "missed_scam" ? "Learned from a missed scam on" : "Learned from a false alarm on";
  return { text: `${what} ${billRef(ref, names)}`, person: null, link };
}

/** "One" to "Twelve", then digits: counts are written as words in a sentence. */
export function countWord(n: number): string {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  return words[n] ?? String(n);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
