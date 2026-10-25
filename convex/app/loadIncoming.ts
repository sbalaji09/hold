// "Load invoices" (Inbox/Today empty state): replays data/incoming.json — the pending batch
// seed.ts deliberately leaves out — through the real intake path (api.app.intake.ingestEmail),
// staggered via the scheduler so the dashboard fills in bill by bill instead of all at once.
// One-shot: a settings flag makes a second click a no-op.
import { mutation, query } from "../_generated/server.js";
import { api } from "../_generated/api.js";
import incoming from "../../data/incoming.json";

const STAGGER_MS = 1400;

export const incomingStatus = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    return { loaded: Boolean(settings?.incomingLoadedAt) };
  },
});

export const startLoadIncoming = mutation({
  args: {},
  handler: async (ctx): Promise<{ started: boolean; count?: number }> => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (settings?.incomingLoadedAt) return { started: false };

    const now = new Date().toISOString();
    if (settings) await ctx.db.patch(settings._id, { incomingLoadedAt: now });
    else await ctx.db.insert("settings", { key: "global", watchOnly: false, incomingLoadedAt: now });

    const items = incoming as Array<{ from: string; subject: string; body: string }>;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      await ctx.scheduler.runAfter(i * STAGGER_MS, api.app.intake.ingestEmail, {
        from: item.from,
        subject: item.subject,
        body: item.body,
        receivedAt: new Date().toISOString(),
      });
    }
    return { started: true, count: items.length };
  },
});
