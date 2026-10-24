// The company this deployment works for (lib/company.ts), from the settings row. Absent = Fogline.
import { query, type QueryCtx } from "../_generated/server.js";
import { companyFor, type Company } from "../../lib/company.js";

export async function getCompany(ctx: QueryCtx): Promise<Company> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  return companyFor(row?.company);
}

/** The whole profile: screens, the voice server and prompts all read it. Nothing secret in it. */
export const current = query({ args: {}, handler: (ctx): Promise<Company> => getCompany(ctx) });
