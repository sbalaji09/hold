// Increase sandbox ACH transfer (plan-agent.md Payments screen / "Increase sandbox" in the
// stack table). sendTransfer is a thin fetch wrapper, no DB access. runPayments is the
// Payments screen's only entry point: it looks up each bill's full routing/account numbers
// server-side (they're never sent to the client — RunPayments.tsx only ever passes bill keys),
// sends the sandbox transfer, and records the result via mutations.recordPayment.
// Env read lazily; a missing key fails loudly instead of faking a transfer.
import { ConvexError, v } from "convex/values";
import { api, internal } from "../_generated/api.js";
import { action, internalAction, internalQuery } from "../_generated/server.js";

const SANDBOX_BASE = "https://sandbox.increase.com";

async function increaseFetch(path: string, apiKey: string, body: unknown): Promise<any> {
  const response = await fetch(`${SANDBOX_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Increase ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export const sendTransfer = internalAction({
  args: {
    routingNumber: v.string(),
    accountNumber: v.string(),
    accountHolder: v.string(), // supplier name, shown on the External Account in the sandbox
    amountCents: v.number(),
    description: v.string(), // statement descriptor, e.g. "Stagecraft #4471"
  },
  handler: async (ctx, args): Promise<{ transferId: string }> => {
    const apiKey = process.env.INCREASE_API_KEY;
    const accountId = process.env.INCREASE_ACCOUNT_ID;
    if (!apiKey) throw new Error("INCREASE_API_KEY is not set");
    if (!accountId) throw new Error("INCREASE_ACCOUNT_ID is not set");

    // Our bankAccounts table only ever keeps the last 4 digits on file (see
    // convex/voice/records.ts), so the full routing/account number for the sandbox External
    // Account has to come from the caller, not from a lookup here.
    const external = await increaseFetch("/external_accounts", apiKey, {
      routing_number: args.routingNumber,
      account_number: args.accountNumber,
      funding: "checking",
      account_holder: "business",
      description: args.accountHolder,
    });

    const transfer = await increaseFetch("/ach_transfers", apiKey, {
      account_id: accountId,
      external_account_id: external.id,
      amount: args.amountCents,
      statement_descriptor: args.description.slice(0, 18),
    });

    return { transferId: transfer.id };
  },
});

/** The bill's active, verified bank account numbers, for runPayments to send a transfer with.
 * Internal only: never exposed to a query the client can call. */
export const payoutDetails = internalQuery({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }) => {
    const bill = await ctx.db
      .query("bills")
      .withIndex("by_key", (q) => q.eq("key", billKey))
      .unique();
    if (!bill) throw new ConvexError(`Unknown bill ${billKey}`);
    const bank = await ctx.db
      .query("bankAccounts")
      .withIndex("by_key", (q) => q.eq("key", bill.bankAccountKey))
      .unique();
    if (!bank) throw new ConvexError(`Unknown bank account ${bill.bankAccountKey}`);
    if (!bank.routingNumber || !bank.accountNumber) {
      throw new ConvexError(`${bank.bank} ··${bank.last4} is missing full routing/account numbers.`);
    }
    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", bill.supplierKey))
      .unique();
    if (!supplier) throw new ConvexError(`Unknown supplier ${bill.supplierKey}`);
    return {
      status: bill.status,
      amountCents: bill.amountCents,
      bankAccountKey: bank.key,
      routingNumber: bank.routingNumber,
      accountNumber: bank.accountNumber,
      accountHolder: supplier.name,
      description: `${supplier.name} #${bill.invoiceNo}`,
    };
  },
});

/**
 * Runs this week's payment run for the given bills: schedules each (if it isn't already),
 * sends an Increase sandbox ACH transfer with its bank account's full numbers (looked up
 * server-side, never passed in by the client), and records the payment. One bill's failure
 * doesn't stop the rest; each result reports success or its own error.
 */
export const runPayments = action({
  args: { billKeys: v.array(v.string()) },
  handler: async (ctx, { billKeys }): Promise<Array<{ billKey: string; transferId?: string; error?: string }>> => {
    const results: Array<{ billKey: string; transferId?: string; error?: string }> = [];
    for (const billKey of billKeys) {
      let paymentKey: string | undefined;
      try {
        const details = await ctx.runQuery(internal.app.increase.payoutDetails, { billKey });
        if (details.status !== "Scheduled") {
          const paid = await ctx.runMutation(api.app.mutations.payBill, { billKey });
          if (paid && typeof paid === "object" && "refused" in paid) throw new Error(paid.refused);
        }
        // Claim the bill before sending the transfer, in the same transaction as the Scheduled
        // check, so a concurrent second run of this bill is refused instead of double-paying.
        const claimed = await ctx.runMutation(internal.app.mutations.claimPayment, {
          billKey,
          bankAccountKey: details.bankAccountKey,
          amountCents: details.amountCents,
        });
        if ("refused" in claimed) throw new Error(claimed.refused);
        paymentKey = claimed.paymentKey;
        const { transferId } = await ctx.runAction(internal.app.increase.sendTransfer, {
          routingNumber: details.routingNumber,
          accountNumber: details.accountNumber,
          accountHolder: details.accountHolder,
          amountCents: details.amountCents,
          description: details.description,
        });
        await ctx.runMutation(internal.app.mutations.recordPayment, {
          billKey,
          paymentKey,
          bankAccountKey: details.bankAccountKey,
          amountCents: details.amountCents,
          transferId,
        });
        results.push({ billKey, transferId });
      } catch (err) {
        if (paymentKey) await ctx.runMutation(internal.app.mutations.failPayment, { paymentKey });
        const message = err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "Payment failed.";
        results.push({ billKey, error: message });
      }
    }
    return results;
  },
});
