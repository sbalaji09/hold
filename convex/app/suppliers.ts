// Suppliers screen: the one write this file owns is adding a new supplier
// (Maya, from the Suppliers list). Background check is Apify's job, a later
// phase — a brand-new supplier simply starts with no background check run.
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server.js";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "supplier") + "_" + Math.random().toString(36).slice(2, 6);
}

export const add = mutation({
  args: {
    name: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, { name, domain }) => {
    const trimmedName = name.trim();
    const trimmedDomain = domain.trim();
    if (!trimmedName || !trimmedDomain) {
      throw new Error("Name and domain are both required to add a supplier.");
    }
    const key = "sup_" + slugify(trimmedName);
    const now = new Date().toISOString();
    await ctx.db.insert("suppliers", {
      key,
      name: trimmedName,
      category: "other",
      domain: trimmedDomain,
      contactName: "",
      contactEmail: "",
      // No background check has run yet: the trusted number comes from that check and a human
      // confirming it, not from this form.
      trustedPhone: "",
      phoneLastCheckedAt: "",
      // New until its first confirmed call (plan-agent.md addendum §3); markTrusted flips this.
      status: "new",
    });
    await ctx.db.insert("activity", {
      key: "act_sup_" + key,
      actor: "maya",
      what: `added ${trimmedName} as a supplier.`,
      why: "New supplier onboarding.",
      refKind: "supplier",
      refKey: key,
      at: now,
    });
    return { key };
  },
});

/**
 * Flips a supplier from New to Trusted after its first confirmed check call. Voice never writes
 * to the suppliers table directly, so this is exposed for the recording path (convex/voice/
 * server.ts's writeResult / finishCall) to call once an outcome of "confirmed" lands; that wiring
 * is outside this file's scope — call this mutation from there with the supplier of the bill the
 * confirmed call belonged to.
 */
export const markTrusted = mutation({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }) => {
    const row = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", supplierKey))
      .unique();
    if (!row) throw new ConvexError(`Unknown supplier ${supplierKey}`);
    if (row.status === "trusted" || row.status === undefined) return;
    await ctx.db.patch(row._id, { status: "trusted" });
    await ctx.db.insert("activity", {
      key: "act_trust_" + crypto.randomUUID(),
      actor: "callback",
      what: `marked ${row.name} as trusted`,
      why: "First confirmed check call.",
      refKind: "supplier",
      refKey: supplierKey,
      at: new Date().toISOString(),
    });
  },
});
