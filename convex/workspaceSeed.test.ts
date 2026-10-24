// The title-company and payroll templates load like Fogline: every planted scam trips the checks it
// claims, nothing real is flagged, and the company, its limit and its people come through.
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./test.setup.js";

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../data/${name}.json`), "utf8"));
const CHECK_ID: Record<string, string> = { "look-alike domain": "domain", "new bank account": "bank-account", "rush language": "rush-language", "unusual amount": "amount" };

describe("template switch", () => {
  test("refuses unless ALLOW_TEMPLATE_SWITCH is on", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.app.workspace.loadTemplate, { company: "harbor", actor: "dev" })).rejects.toThrow(/ALLOW_TEMPLATE_SWITCH/);
    expect((await t.query(api.app.workspace.templateSwitch, {})).allowed).toBe(false);
  });

  test("loads another company and keeps what hold learned", async () => {
    process.env.ALLOW_TEMPLATE_SWITCH = "true";
    try {
      const t = convexTest(schema, modules);
      await t.mutation(api.app.workspace.loadTemplate, { company: "fogline", actor: "dev" });
      const learned = await t.run((ctx) =>
        ctx.db.insert("fraudTechniques", {
          key: "tech_learned",
          name: "Learned at Fogline",
          howItWorks: "x",
          signals: ["x"],
          example: "x",
          status: "active",
          sourceKind: "taught",
          createdAt: "2026-10-23",
        }),
      );
      await t.mutation(api.app.workspace.loadTemplate, { company: "harbor", actor: "dev" });
      expect((await t.query(api.app.company.current, {})).key).toBe("harbor");
      expect(await t.run((ctx) => ctx.db.get(learned))).not.toBeNull();
      const payees = await t.run((ctx) => ctx.db.query("suppliers").collect());
      expect(payees.every((p) => p.key.startsWith("emp_"))).toBe(true);
      const log = await t.run((ctx) => ctx.db.query("activity").collect());
      expect(log.some((a) => a.what === "loaded the Harbor Health template")).toBe(true);
    } finally {
      delete process.env.ALLOW_TEMPLATE_SWITCH;
    }
  });
});

describe.each(["bayline", "harbor"])("%s template", (name) => {
  const data = load(name);

  test("seeds as its company, with every planted scam flagged as declared and nothing else flagged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seed, data);
    expect((await t.query(api.app.company.current, {})).key).toBe(name);

    const bills = await t.run((ctx) => ctx.db.query("bills").collect());
    const scams = new Map<string, string[]>(data.plantedScams.map((s: { billKey: string; checksThatShouldFire: string[] }) => [s.billKey, s.checksThatShouldFire]));
    for (const bill of bills) {
      const flagged = new Set((bill.checks ?? []).filter((c) => c.state === "flag").map((c) => c.id));
      const expected = scams.get(bill.key);
      if (expected) expect([...flagged].sort(), bill.key).toEqual(expected.map((c) => CHECK_ID[c]).sort());
      else expect([...flagged], bill.key).toEqual([]);
    }
  });

  test("the demo payee rings DEMO_PAYEE_PHONE, everyone else keeps their number", async () => {
    process.env.DEMO_PAYEE_PHONE = "+14155550199";
    try {
      const t = convexTest(schema, modules);
      await t.mutation(internal.seed.seed, data);
      const rows = await t.run((ctx) => ctx.db.query("suppliers").collect());
      expect(rows.find((s) => s.key === data.hero)?.trustedPhone).toBe("+14155550199");
      expect(rows.filter((s) => s.trustedPhone === "+14155550199")).toHaveLength(1);
    } finally {
      delete process.env.DEMO_PAYEE_PHONE;
    }
  });
});
