// One-off data fixes for deployments with rows from before a schema change. Run from the CLI:
//   npx convex run migrations:dropMaya '{"table":"activity"}'   (once per table; see dropMayaTables)
// "Remove Maya" (74e90c9) folded the second person into the one approver ("dev") and the
// "to_maya" route into "to_dev", without rewriting old rows, so a deploy fails schema validation.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import schema from "./schema.js";

const RENAMED: Record<string, string> = { maya: "dev", to_maya: "to_dev" };

/** Every string value that is exactly an old name becomes the new one; free text is untouched. */
function rename(value: unknown): unknown {
  if (typeof value === "string") return RENAMED[value] ?? value;
  if (Array.isArray(value)) return value.map(rename);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, rename(x)]));
  return value;
}

export const dropMayaTables = internalQuery({ args: {}, handler: async () => Object.keys(schema.tables) });

export const dropMaya = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    let changed = 0;
    // ponytail: one table per transaction, fine for demo-sized tables; paginate if one outgrows a mutation.
    for (const doc of await ctx.db.query(table as keyof typeof schema.tables).collect()) {
      const { _id, _creationTime, ...fields } = doc;
      const next = rename(fields);
      if (JSON.stringify(next) === JSON.stringify(fields)) continue;
      await ctx.db.replace(_id, next as never);
      changed++;
    }
    return changed;
  },
});
