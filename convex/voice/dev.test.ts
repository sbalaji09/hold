import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const STAGE_ROW = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};

test("requestCall queues a call to the number on file, live or simulated", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("suppliers", STAGE_ROW));
  await t.mutation(internal.voice.dev.setSupplierPhone, { supplier_id: "sup_stage", phone: "+14155550199" });

  const live = await t.mutation(internal.voice.dev.requestCall, { supplier_id: "sup_stage" });
  const sim = await t.mutation(internal.voice.dev.requestCall, { supplier_id: "sup_stage", simulated: true });

  const rows = await t.run((ctx) => ctx.db.query("callRequests").collect());
  expect(rows.map((r) => [r.to_number, r.number_source, r.status, r.mode])).toEqual([
    ["+14155550199", "on_file", "queued", "live"],
    ["+14155550199", "on_file", "queued", "simulated"],
  ]);
  expect(live.call_id).not.toBe(sim.call_id);
});

test("setSupplierPhone rejects numbers that aren't E.164", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("suppliers", STAGE_ROW));
  await expect(
    t.mutation(internal.voice.dev.setSupplierPhone, { supplier_id: "sup_stage", phone: "415 555 0199" }),
  ).rejects.toThrow(/E\.164/);
});
