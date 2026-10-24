// Learned rules (plan-agent.md addendum §1): saved when you resolve an escalation, or proposed
// by hold after a check call (callOutcome.ts's applyCallResult) for you to keep or dismiss.
// Shown on the supplier and bill pages and cited on later bills by checks.ts's "Learned rule
// applies" check. Never relax a hard limit — only you can activate a rule, and checks.ts is the
// only place an active rule can change a decision (and only the narrow branches it documents).
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";
import type { LearnedRule } from "../../lib/types.js";

function freshKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toLearnedRule(r: Doc<"learnedRules">): LearnedRule {
  return {
    key: r.key,
    supplierKey: r.supplierKey,
    text: r.text,
    createdBy: r.createdBy,
    sourceKind: r.sourceKind,
    sourceKey: r.sourceKey,
    createdAt: r.createdAt,
    kind: r.kind,
    bankLast4: r.bankLast4,
    bankName: r.bankName,
    status: r.status ?? "active",
    proposedBy: r.proposedBy,
  };
}

/** You save a rule after resolving an escalation. Callback itself is refused: a rule is
 * a human decision, never something the agent grants itself. */
export const saveRule = mutation({
  args: {
    supplierKey: v.string(),
    text: v.string(),
    actor: v.union(v.literal("callback"), v.literal("dev")),
    sourceKind: v.string(),
    sourceKey: v.string(),
  },
  handler: async (ctx, { supplierKey, text, actor, sourceKind, sourceKey }): Promise<{ key: string }> => {
    if (actor !== "dev") {
      throw new ConvexError("hold can't save a rule on its own. You have to write it.");
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
      kind: "note",
      status: "active",
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

/** Written by callOutcome.ts's applyCallResult right after a check call finishes on a bank
 * change. Never activates on its own — the row lands as "proposed" until a person keeps it.
 * Idempotent per sourceKey (one call proposes at most one rule). */
export const proposeRule = internalMutation({
  args: {
    supplierKey: v.string(),
    text: v.string(),
    kind: v.union(v.literal("verified_account"), v.literal("never_changed_bank")),
    bankLast4: v.optional(v.string()),
    bankName: v.optional(v.string()),
    sourceKind: v.string(),
    sourceKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ key: string }> => {
    const existing = await ctx.db
      .query("learnedRules")
      .withIndex("by_source", (q) => q.eq("sourceKey", args.sourceKey))
      .first();
    if (existing) return { key: existing.key };

    const supplierRules = await ctx.db
      .query("learnedRules")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", args.supplierKey))
      .collect();
    const alreadyLearned = supplierRules.find(
      (r) =>
        r.status !== "dismissed" &&
        r.kind === args.kind &&
        (args.kind !== "verified_account" || r.bankLast4 === args.bankLast4),
    );
    if (alreadyLearned) return { key: alreadyLearned.key };

    const key = freshKey("rule");
    const now = new Date().toISOString();
    await ctx.db.insert("learnedRules", {
      key,
      supplierKey: args.supplierKey,
      text: args.text,
      createdBy: "dev",
      proposedBy: "callback",
      sourceKind: args.sourceKind,
      sourceKey: args.sourceKey,
      createdAt: now,
      kind: args.kind,
      bankLast4: args.bankLast4,
      bankName: args.bankName,
      status: "proposed",
    });
    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", args.supplierKey))
      .unique();
    const supplierName = supplier?.name ?? args.supplierKey;
    await ctx.db.insert("activity", {
      key: freshKey("act"),
      actor: "callback",
      what: `proposed a rule for ${supplierName}`,
      why: args.text,
      refKind: "supplier",
      refKey: args.supplierKey,
      at: now,
    });
    return { key };
  },
});

async function requireRule(ctx: MutationCtx, key: string): Promise<Doc<"learnedRules">> {
  const row = await ctx.db
    .query("learnedRules")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) throw new ConvexError("That rule doesn't exist.");
  return row;
}

/** You keep a rule hold proposed. Only then can it change a check (checks.ts filters to
 * status "active"). Callback can never activate its own proposal. */
export const keepRule = mutation({
  args: { key: v.string(), actor: v.union(v.literal("callback"), v.literal("dev")), text: v.optional(v.string()) },
  handler: async (ctx, { key, actor, text }): Promise<void> => {
    if (actor !== "dev") {
      throw new ConvexError("hold can't keep its own rule. You have to.");
    }
    const row = await requireRule(ctx, key);
    const trimmed = text?.trim();
    const finalText = trimmed || row.text;
    await ctx.db.patch(row._id, { status: "active", text: finalText });
    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", row.supplierKey))
      .unique();
    const supplierName = supplier?.name ?? row.supplierKey;
    await ctx.db.insert("activity", {
      key: freshKey("act"),
      actor: "dev",
      what: `kept a rule for ${supplierName}`,
      why: finalText,
      refKind: "supplier",
      refKey: row.supplierKey,
      at: new Date().toISOString(),
    });
  },
});

/** You dismiss a rule hold proposed; it never applies to a check. */
export const dismissRule = mutation({
  args: { key: v.string(), actor: v.union(v.literal("callback"), v.literal("dev")) },
  handler: async (ctx, { key, actor }): Promise<void> => {
    if (actor !== "dev") {
      throw new ConvexError("hold can't dismiss its own rule. You have to.");
    }
    const row = await requireRule(ctx, key);
    await ctx.db.patch(row._id, { status: "dismissed" });
    const supplier = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", row.supplierKey))
      .unique();
    const supplierName = supplier?.name ?? row.supplierKey;
    await ctx.db.insert("activity", {
      key: freshKey("act"),
      actor: "dev",
      what: `dismissed a rule for ${supplierName}`,
      why: row.text,
      refKind: "supplier",
      refKey: row.supplierKey,
      at: new Date().toISOString(),
    });
  },
});

/** Active and proposed rules for a supplier, newest first. Dismissed rules never show. */
export const listRules = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }): Promise<LearnedRule[]> => {
    const rows = await ctx.db
      .query("learnedRules")
      .withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey))
      .collect();
    return rows
      .filter((r) => (r.status ?? "active") !== "dismissed")
      .map(toLearnedRule)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
});

/** The rule hold proposed from this bill's latest call, if any and still waiting on you. */
export const proposedForBill = query({
  args: { billKey: v.string() },
  handler: async (ctx, { billKey }): Promise<LearnedRule | null> => {
    const requests = await ctx.db
      .query("callRequests")
      .withIndex("by_bill", (q) => q.eq("bill_id", billKey))
      .collect();
    if (requests.length === 0) return null;
    const latest = requests.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
    const row = await ctx.db
      .query("learnedRules")
      .withIndex("by_source", (q) => q.eq("sourceKey", latest.call_id))
      .first();
    if (!row || row.sourceKind !== "call" || row.status !== "proposed") return null;
    return toLearnedRule(row);
  },
});
