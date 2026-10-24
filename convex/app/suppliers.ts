// Suppliers screen: the one write this file owns is adding a new supplier
// (Maya, from the Suppliers list). Background check is Apify's job, a later
// phase — a brand-new supplier simply starts with no background check run.
import { v } from "convex/values";
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
    phone: v.string(),
  },
  handler: async (ctx, { name, domain, phone }) => {
    const trimmedName = name.trim();
    const trimmedDomain = domain.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || !trimmedDomain || !trimmedPhone) {
      throw new Error("Name, domain and phone are all required to add a supplier.");
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
      trustedPhone: trimmedPhone,
      // No background check has run yet, so there's nothing to date the
      // trusted number to. phoneLastCheckedAt stays "" until one runs.
      phoneLastCheckedAt: "",
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
