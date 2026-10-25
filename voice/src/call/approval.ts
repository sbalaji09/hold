// Approval call: someone from a company hold has no record of phoned the line and asked for money
// (gift cards, a payment, a purchase). There's no number on file to check with, so hold rings the
// approver, tells them what the caller said and asks: approve or deny. Only a clear answer counts;
// anything else is no decision, which leaves the request unapproved.
import type { ApprovalAsk, CallResult } from "../../../shared/contract.js";
import { companyFor, type Company } from "../../../lib/company.js";
import type { OutboundCallDeps } from "./index.js";
import { CallSession } from "./session.js";

export const APPROVAL_LIMITS = { listenTimeoutMs: 10_000, asks: 2 } as const;

export type Decision = "approved" | "denied" | "no_decision";

const APPROVE = /\b(?:approve[ds]?|approving|yes|yeah|yep|go ahead|do it|okay|ok|sure|fine|allow(?:ed)?|accept(?:ed)?)\b/i;
const DENY = /\b(?:deny|denied|no|nope|reject(?:ed)?|decline[ds]?|don'?t|do not|refuse[ds]?|block)\b/i;

/** "Approve" or "deny" in the approver's words. Both, or neither ("don't approve it"), is unclear. */
export function readDecision(text: string): Decision {
  const yes = APPROVE.test(text);
  const no = DENY.test(text);
  return yes === no ? "no_decision" : yes ? "approved" : "denied";
}

/** "+14155550123" read one digit at a time, grouped like a US number. */
export function spokenPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const groups = d.length === 10 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6)] : [d];
  return groups.map((g) => g.split("").join(" ")).join(", ");
}

export function approvalLines(a: ApprovalAsk, co: Company = companyFor(undefined)) {
  const who = a.company && !a.caller.toLowerCase().includes(a.company.toLowerCase()) ? `${a.caller} from ${a.company}` : a.caller;
  return {
    opening: `Hi, this is hold, the automated assistant for ${co.owner} ${co.team}. This call is recorded. Someone just called our line with a request that needs your decision.`,
    facts: `The caller said they were ${who}, calling from ${spokenPhone(a.caller_number)}. They asked us to ${a.request}. ${co.name} has no ${co.payee.one} by that name, so there's no number on file to check with.`,
    ask: "Do you approve or deny it?",
    again: "Sorry, I didn't catch that. Should I approve or deny the request?",
    approved: "Got it, approved. I've logged your approval. Goodbye.",
    denied: "Got it, denied. I've logged it, and nothing will be sent. Goodbye.",
    none: "I didn't get a decision, so the request stays unapproved and I've logged it for you. Goodbye.",
  };
}

const OUTCOME: Record<Decision, CallResult["outcome"]> = { approved: "confirmed", denied: "not_confirmed", no_decision: "handed_off" };

export async function runApprovalCall(deps: OutboundCallDeps): Promise<CallResult> {
  const { store, transport, request, prepared } = deps;
  const a = request.approval!;
  const L = approvalLines(a, prepared.company);
  const session = new CallSession(store, transport, request.call_id, "supplier");
  let decision: Decision = "no_decision";
  let heard = "";
  try {
    await store.markInProgress(request.call_id);
    await session.say(L.opening, { opening: true });
    if (!session.over) await session.say(`${L.facts} ${L.ask}`);
    for (let i = 0; i < APPROVAL_LIMITS.asks && !session.over && decision === "no_decision"; i++) {
      if (i > 0) await session.say(L.again);
      const u = await session.hear(APPROVAL_LIMITS.listenTimeoutMs);
      if (!u) continue;
      heard = u.text;
      decision = readDecision(u.text);
    }
    if (!session.over) await session.say(L[decision === "no_decision" ? "none" : decision]);
    if (!session.over) await session.hangup();
    await session.recordUnheard();
  } catch (err) {
    console.error(`[approval ${request.call_id}] call failed:`, err);
    await session.hangup();
  }

  const result: CallResult = {
    call_id: request.call_id,
    outcome: OUTCOME[decision],
    evidence: heard ? [{ ask: L.ask, answer: heard, matches: decision === "approved" }] : [],
    summary:
      decision === "no_decision"
        ? `The approver gave no clear decision on ${a.caller}'s request to ${a.request}, so it stays unapproved.`
        : `The approver ${decision} ${a.caller}'s request to ${a.request}${heard ? `, saying "${heard}"` : ""}.`,
  };
  await store.finishCall(result);
  return result;
}
