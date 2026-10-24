// A tiny "something changed" signal for the app's server-rendered pages. The browser subscribes to
// it, and when it moves the cached pages are refreshed in the background (components/NavLinks.tsx),
// so tabs open instantly from cache yet never show stale bills.
import { query } from "../_generated/server.js";

/**
 * Bumps whenever hold or a person does something: every bill, call, payment and message change
 * writes an activity row, and new emails and inbound calls arrive as rows of their own.
 */
export const changeStamp = query({
  args: {},
  handler: async (ctx) => {
    const [activity, email, inbound] = await Promise.all([
      ctx.db.query("activity").order("desc").first(),
      ctx.db.query("emails").order("desc").first(),
      ctx.db.query("inboundCalls").order("desc").first(),
    ]);
    return Math.max(activity?._creationTime ?? 0, email?._creationTime ?? 0, inbound?._creationTime ?? 0);
  },
});
