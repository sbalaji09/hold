// Learned rules (plan-agent.md addendum §1): saved when Maya or Dev resolves an escalation.
// Shown on the supplier page and cited on later bills by checks.ts's "Learned rule applies"
// check. Never relax a hard limit — only Maya or Dev can save one, and checks.ts is the only
// place a rule can change a decision (and only the one narrow branch it documents).
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import type { LearnedRule } from "../../lib/types.js";

function freshKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Maya or Dev saves a rule after resolving an escalation. Callback itself is refused: a rule is
 * a human decision, never something the agent grants itself. */
export const saveRule = mutation({
  args: {
    supplierKey: v.string(),
    text: v.string(),
    actor: v.union(v.literal("callback"), v.literal("maya"), v.literal("dev")),
    sourceKind: v.string(),
    sourceKey: v.string(),
  },
  handler: async (ctx, { supplierKey, text, actor, sourceKind, sourceKey }): Promise<{ key: string }> => {
    if (actor !== "maya" && actor !== "dev") {
      throw new ConvexError("Callback can't save a rule on its own. Maya or Dev has to write it.");
    }
    const trimmed = text.trim();
    if (!trimmed) throw new ConvexError("A rule needs words to save.");

    const key = freshKey("rule");
    const now = new Date().toISOString();
    await ctx.db.insert("learnedRules", {
      key,
      supplierKey,
      text: trimmed,
      createdBy: actor,
      sourceKind,
      sourceKey,
      createdAt: now,
    });
    await ctx.db.insert("activity", {
      key: freshKey("act"),
      actor,
      what: `saved a rule for ${supplierKey}`,
      why: trimmed,
      refKind: "supplier",
      refKey: supplierKey,
      at: now,
    });
    return { key };
  },
});

export const listRules = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<LearnedRule[]> => {
    const rows = await ctx.db
      .query("learnedRules")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    return rows
      .map((r) => ({
        key: r.key,
        supplierKey: r.supplierKey,
        text: r.text,
        createdBy: r.createdBy,
        sourceKind: r.sourceKind,
        sourceKey: r.sourceKey,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
});
