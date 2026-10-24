// Proves seed.ts (not just lib/data.ts's JSON fallback) derives each bill's `checks` and plants
// the same pending approvals the JSON-mode listApprovals would show, so a seeded Convex
// deployment demos exactly like `pnpm dev` without NEXT_PUBLIC_CONVEX_URL set.
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./test.setup.js";

const fogline = JSON.parse(readFileSync(join(import.meta.dirname, "../data/fogline.json"), "utf8"));

async function seeded() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, fogline);
  return t;
}

describe("seed", () => {
  test("planted-scam bills carry at least one flagged check", async () => {
    const t = await seeded();
    const bills = await t.run((ctx) => ctx.db.query("bills").collect());
    const scamBillKeys = new Set(fogline.plantedScams.map((s: { billKey: string }) => s.billKey));
    for (const bill of bills) {
      if (!scamBillKeys.has(bill.key)) continue;
      expect(bill.checks?.some((c: { state: string }) => c.state === "flag")).toBe(true);
    }
  });

  test("approvals count matches JSON-mode listApprovals (Held/Needs-you + unpaid over $10k)", async () => {
    const t = await seeded();
    const approvals = await t.run((ctx) => ctx.db.query("approvals").collect());
    const TEN_THOUSAND_CENTS = 1_000_000;
    const expected = fogline.bills.filter(
      (b: { status: string; amountCents: number }) =>
        b.status === "Held" || b.status === "Needs you" || (b.amountCents > TEN_THOUSAND_CENTS && b.status !== "Paid"),
    ).length;
    expect(expected).toBe(7);
    expect(approvals).toHaveLength(expected);
    expect(approvals.every((a) => a.status === "pending")).toBe(true);
  });
});
