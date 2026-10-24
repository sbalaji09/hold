// DEV ONLY: start test calls from the terminal until the app's bill page has its Call button.
// Internal functions, so only `npx convex run` (or the dashboard) can call them, never a browser.
//   npx convex run voice/dev:requestCall '{"supplier_id":"sup_stage","simulated":true}'
//   npx convex run voice/dev:setSupplierPhone '{"supplier_id":"sup_stage","phone":"+1..."}'
import { v } from "convex/values";
import { internalMutation } from "../_generated/server.js";
import * as records from "./records.js";

/** Queues a check call to the supplier's number on file, exactly as the app will. */
export const requestCall = internalMutation({
  args: {
    supplier_id: v.string(),
    simulated: v.optional(v.boolean()),
    bill_id: v.optional(v.string()),
    reason: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const supplier = await records.getSupplierProfile(ctx, args.supplier_id);
    if (!supplier) throw new Error(`Unknown supplier_id: ${args.supplier_id}`);
    // Random suffix: two requests in the same millisecond must not share a call_id.
    const call_id = `call_dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await ctx.db.insert("callRequests", {
      call_id,
      bill_id: args.bill_id ?? "dev_test",
      supplier_id: supplier.supplier_id,
      to_number: supplier.phone_on_file, // never a number from the caller or an email
      number_source: "on_file",
      reason: args.reason ?? ["new bank account", "writing style doesn't match past emails"],
      status: "queued",
      mode: args.simulated ? "simulated" : "live",
      attempt: 0,
    });
    return { call_id, to_number: supplier.phone_on_file, mode: args.simulated ? "simulated" : "live" };
  },
});

/**
 * Demo setup: the supplier's trusted number must be a real phone that a teammate holds.
 * Changing it here is a setup step, never something a call can do.
 */
export const setSupplierPhone = internalMutation({
  args: { supplier_id: v.string(), phone: v.string() },
  handler: async (ctx, { supplier_id, phone }) => {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("phone must be E.164, e.g. +14155550123");
    const row = await ctx.db
      .query("suppliers")
      .withIndex("by_key", (q) => q.eq("key", supplier_id))
      .unique();
    if (!row) throw new Error(`Unknown supplier_id: ${supplier_id}`);
    await ctx.db.patch(row._id, { trustedPhone: phone });
    return { supplier_id, phone };
  },
});
