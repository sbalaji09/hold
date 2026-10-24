// Nightly look-alike watch: the Apify actor's "watch" mode generates the domains a scammer would
// register to imitate each supplier and reports the ones that exist. hold keeps them, so an email
// from one is flagged on arrival with "hold has watched this domain since ...", often days before
// the scam is sent. Apify only: with no APIFY_TOKEN the watch doesn't run.
//
// The run takes longer than a sync call should wait, so startWatch starts it and finishWatch
// checks back every minute until it's done.
import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { internalAction, internalMutation, internalQuery, query } from "../_generated/server.js";

const APIFY_BASE = "https://api.apify.com/v2";
const actorId = () => process.env.APIFY_ACTOR_ID ?? "hold-supplier-verifier";

/** A dataset item from the actor's watch mode (it also carries fields hold doesn't keep). */
type Hit = { domain: string; imitates: string; technique: string; registeredDaysAgo: number | null; receivesEmail?: boolean };

/** Only the fields saveHits accepts; Convex rejects anything extra. */
export function toHitArgs(h: Hit) {
  return {
    domain: h.domain,
    imitates: h.imitates,
    technique: h.technique,
    registeredDaysAgo: h.registeredDaysAgo ?? undefined,
    receivesEmail: h.receivesEmail ?? undefined,
  };
}

export const startWatch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ runId: string } | null> => {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      console.warn("look-alike watch skipped: APIFY_TOKEN isn't set");
      return null;
    }
    const suppliers = await ctx.runQuery(internal.app.onboarding.knownSuppliers, {});
    const domains = [...new Set(suppliers.map((s) => s.domain.toLowerCase()).filter(Boolean))];
    if (domains.length === 0) return null;
    const res = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId())}/runs?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "watch", domains }),
    });
    if (!res.ok) throw new Error(`Apify watch run didn't start (${res.status}): ${await res.text()}`);
    const runId = ((await res.json()) as { data: { id: string } }).data.id;
    await ctx.scheduler.runAfter(60_000, internal.app.watch.finishWatch, { runId, attempt: 1 });
    return { runId };
  },
});

export const finishWatch = internalAction({
  args: { runId: v.string(), attempt: v.number() },
  handler: async (ctx, { runId, attempt }): Promise<void> => {
    const token = process.env.APIFY_TOKEN;
    if (!token) return;
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`Apify watch run ${runId} lookup failed (${res.status})`);
    const run = ((await res.json()) as { data: { status: string; defaultDatasetId: string; actId: string } }).data;
    if (run.status === "READY" || run.status === "RUNNING") {
      if (attempt < 30) await ctx.scheduler.runAfter(60_000, internal.app.watch.finishWatch, { runId, attempt: attempt + 1 });
      else console.warn(`look-alike watch ${runId} still running after 30 minutes; giving up`);
      return;
    }
    if (run.status !== "SUCCEEDED") throw new Error(`Apify watch run ${runId} ended ${run.status}`);
    const items = await fetch(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(token)}`);
    if (!items.ok) throw new Error(`Apify watch dataset read failed (${items.status})`);
    await ctx.runMutation(internal.app.watch.saveHits, {
      hits: ((await items.json()) as Hit[]).map(toHitArgs),
      runUrl: `https://console.apify.com/actors/${run.actId}/runs/${runId}`,
    });
  },
});

export const saveHits = internalMutation({
  args: {
    hits: v.array(
      v.object({
        domain: v.string(),
        imitates: v.string(),
        technique: v.string(),
        registeredDaysAgo: v.optional(v.number()),
        receivesEmail: v.optional(v.boolean()),
      }),
    ),
    runUrl: v.string(),
  },
  handler: async (ctx, { hits, runUrl }): Promise<{ added: number }> => {
    const now = new Date().toISOString();
    const suppliers = await ctx.db.query("suppliers").collect();
    const added: string[] = [];
    for (const h of hits) {
      const supplier = suppliers.find((s) => s.domain.toLowerCase() === h.imitates);
      if (!supplier) continue;
      const fields = {
        supplierKey: supplier.key,
        imitates: h.imitates,
        technique: h.technique,
        registeredDaysAgo: h.registeredDaysAgo,
        receivesEmail: h.receivesEmail,
        lastSeenAt: now,
        runUrl,
      };
      const existing = await ctx.db.query("watchedDomains").withIndex("by_domain", (q) => q.eq("domain", h.domain)).unique();
      if (existing) await ctx.db.patch(existing._id, fields);
      else {
        await ctx.db.insert("watchedDomains", { domain: h.domain, firstSeenAt: now, ...fields });
        added.push(h.domain);
      }
    }
    await ctx.db.insert("activity", {
      key: `act_watch_${crypto.randomUUID()}`,
      actor: "callback",
      what: `ran the nightly look-alike watch on ${suppliers.length} suppliers' domains.`,
      why: added.length > 0 ? `${added.length} newly registered: ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}.` : "No new look-alike domains.",
      refKind: "watch",
      refKey: runUrl,
      at: now,
    });
    return { added: added.length };
  },
});

/** The watched look-alike a sender's domain is, with the supplier it imitates, or null. */
export const watchedDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    const row = await ctx.db.query("watchedDomains").withIndex("by_domain", (q) => q.eq("domain", domain.toLowerCase())).unique();
    if (!row) return null;
    const supplier = await ctx.db.query("suppliers").withIndex("by_key", (q) => q.eq("key", row.supplierKey)).unique();
    return supplier ? { ...row, supplierName: supplier.name } : null;
  },
});

export const listForSupplier = query({
  args: { supplierKey: v.string() },
  handler: async (ctx, { supplierKey }) =>
    (await ctx.db.query("watchedDomains").withIndex("by_supplier", (q) => q.eq("supplierKey", supplierKey)).collect()).sort((a, b) =>
      a.firstSeenAt < b.firstSeenAt ? 1 : -1,
    ),
});
