// Approvals "pushback" (plan-agent.md step: Dev writes "Release it, we'll miss the stage build.").
// Claude answers with the call's own evidence and clip, then offers the safe alternative: paying
// the supplier's old, verified account instead of the one on this bill.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { api, internal } from "../_generated/api.js";
import { action, internalQuery } from "../_generated/server.js";

export const PUSHBACK_MODEL = "claude-sonnet-5-5";

export interface PushbackEvidence {
  summary: string;
  outcome: string;
  turns: Array<{ ask: string; answer: string; matches: boolean }>;
  clip: { start_s: number; end_s: number } | null;
}

export interface PushbackInput {
  invoiceNo: string;
  supplierName: string;
  amountCents: number;
  devText: string;
  call: PushbackEvidence;
  oldAccount: { bank: string; last4: string };
}

const Reply = z.object({ text: z.string() });

const SYSTEM = `You are Callback, an automated bookkeeping assistant. Dev, the controller, is pushing back on a bill
you held because a check call didn't confirm the supplier's new bank details.
Reply in 2-4 short sentences, in Callback's voice: calm, specific, never defensive.
- Quote what the supplier actually said on the call (from the evidence given), not a generic warning.
- Name the specific check that failed and why that matters.
- Offer to pay the old, verified account instead, naming its bank and last 4 digits.
- Never agree to release the payment to the unverified account. Never invent facts not in the evidence.`;

export function buildPrompt(input: PushbackInput): string {
  const amount = `$${(input.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const turns = input.call.turns.length
    ? input.call.turns.map((t) => `- Asked: "${t.ask}" | Answer: "${t.answer}" | Matches invoice: ${t.matches}`).join("\n")
    : "(no recorded Q&A)";
  const clip = input.call.clip ? `Clip available at ${input.call.clip.start_s}s-${input.call.clip.end_s}s.` : "No clip recorded.";
  return `Bill: invoice #${input.invoiceNo} from ${input.supplierName}, ${amount}.
Call outcome: ${input.call.outcome}. Call summary: ${input.call.summary}
Call evidence:
${turns}
${clip}
Old, verified account on file: ${input.oldAccount.bank} ··${input.oldAccount.last4}.

Dev wrote: "${input.devText}"

Reply to Dev.`;
}

/** The bill's most recent call result, with its evidence and clip, for Claude's prompt. */
export const callEvidence = internalQuery({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const requests = await ctx.db
      .query("callRequests")
      .withIndex("by_bill", (q) => q.eq("bill_id", billKey))
      .collect();
    if (requests.length === 0) return null;
    const request = requests.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    const result = await ctx.db
      .query("callResults")
      .withIndex("by_call", (q) => q.eq("call_id", request.call_id))
      .unique();
    if (!result) return null;
    return {
      summary: result.summary,
      outcome: result.outcome,
      turns: result.evidence.map((e) => ({ ask: e.ask, answer: e.answer, matches: e.matches })),
      clip: result.clip ?? null,
    };
  },
});

/** The supplier's other bank account on file, preferring an active one, oldest first. */
export const oldVerifiedAccount = internalQuery({
  args: { supplierKey: v.string(), excludeBankAccountKey: v.string() },
  handler: async (ctx, { supplierKey, excludeBankAccountKey }) => {
    const rows = await ctx.db
      .query("bankAccounts")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    const candidates = rows.filter((r) => r.key !== excludeBankAccountKey);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const byStatus = (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1);
      return byStatus !== 0 ? byStatus : a.addedAt < b.addedAt ? -1 : 1;
    });
    const best = candidates[0]!;
    return { key: best.key, bank: best.bank, last4: best.last4 };
  },
});

export const reply = action({
  args: { billKey: v.string(), text: v.string() },
  handler: async (
    ctx,
    { billKey, text },
  ): Promise<{ text: string; clip: { start_s: number; end_s: number } | null; safeAlternative: { bankAccountKey: string } }> => {
    const bill = await ctx.runQuery(api.app.queries.getBill, { key: billKey });
    if (!bill) throw new ConvexError(`Unknown bill ${billKey}`);

    const call = await ctx.runQuery(internal.app.pushback.callEvidence, { billKey });
    if (!call) throw new ConvexError(`No call evidence on file for bill ${billKey} yet.`);

    const oldAccount = await ctx.runQuery(internal.app.pushback.oldVerifiedAccount, {
      supplierKey: bill.supplierKey,
      excludeBankAccountKey: bill.bankAccountKey,
    });
    if (!oldAccount) throw new ConvexError(`No other verified bank account on file for ${bill.supplier.name}.`);

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ConvexError("ANTHROPIC_API_KEY is not set; pushback can't reach Claude.");
    }
    const client = new Anthropic(); // ANTHROPIC_API_KEY from the Convex env
    const response = await client.messages.parse({
      model: PUSHBACK_MODEL,
      max_tokens: 1000,
      output_config: { effort: "medium", format: zodOutputFormat(Reply) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: buildPrompt({
            invoiceNo: bill.invoiceNo,
            supplierName: bill.supplier.name,
            amountCents: bill.amountCents,
            devText: text,
            call,
            oldAccount,
          }),
        },
      ],
    });
    const parsed = response.parsed_output;
    if (response.stop_reason === "refusal" || !parsed) {
      throw new Error(`pushback: no reply from Claude (stop_reason ${response.stop_reason})`);
    }
    return { text: parsed.text, clip: call.clip, safeAlternative: { bankAccountKey: oldAccount.key } };
  },
});
