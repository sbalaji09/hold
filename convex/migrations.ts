// One-off data fixes for deployments seeded before a schema change. Idempotent; run with
//   npx convex run migrations:paymentStatuses
import { internalMutation } from "./_generated/server";

/**
 * payments.status became pending | sent | failed (the claim-before-pay flow). Rows seeded earlier
 * still say "Paid" or "Scheduled"; map them the way convex/seed.ts now does, so the schema deploys.
 */
export const paymentStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    let fixed = 0;
    for (const p of await ctx.db.query("payments").collect()) {
      const status = p.status as string;
      if (status === "pending" || status === "sent" || status === "failed") continue;
      await ctx.db.patch(p._id, { status: "sent" });
      fixed++;
    }
    return { fixed };
  },
});
