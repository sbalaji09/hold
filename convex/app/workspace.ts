// Switch the workspace to another company template (lib/company.ts): Fogline's festival bills,
// Bayline Title's closing wires or Harbor Health's payroll. It replaces every payee, bill, email,
// payment and call, so it only runs where ALLOW_TEMPLATE_SWITCH=true is set in the Convex env.
// The learned playbooks are kept: what hold learned at one company protects the next.
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server.js";
import { runSeed, type SeedArgs } from "../seed.js";
import { COMPANIES, type CompanyKey } from "../../lib/company.js";
import fogline from "../../data/fogline.json";
import bayline from "../../data/bayline.json";
import harbor from "../../data/harbor.json";

const TEMPLATES = {
  fogline: { ...fogline, hero: "sup_stage" },
  bayline,
  harbor,
} as unknown as Record<CompanyKey, SeedArgs>;

const switchAllowed = () => process.env.ALLOW_TEMPLATE_SWITCH === "true";

export const SWITCH_OFF =
  "Switching templates is off for this deployment: it replaces every bill, payee and call. Set ALLOW_TEMPLATE_SWITCH=true in the Convex env to allow it.";

export const templateSwitch = query({
  args: {},
  handler: async (): Promise<{ allowed: boolean }> => ({ allowed: switchAllowed() }),
});

export const loadTemplate = mutation({
  args: {
    company: v.union(v.literal("fogline"), v.literal("bayline"), v.literal("harbor")),
    actor: v.literal("dev"),
  },
  handler: async (ctx, { company, actor }) => {
    if (!switchAllowed()) throw new ConvexError(SWITCH_OFF);
    await runSeed(ctx, { ...TEMPLATES[company], company, keepPlaybooks: true });
    const co = COMPANIES[company];
    await ctx.db.insert("activity", {
      key: `act_${crypto.randomUUID()}`,
      actor,
      what: `loaded the ${co.name} template`,
      why: `Replaced the workspace's ${co.payee.many}, ${co.bill.many} and calls with ${co.owner}. Learned playbooks carried over.`,
      refKind: "settings",
      refKey: "global",
      at: new Date().toISOString(),
    });
  },
});
