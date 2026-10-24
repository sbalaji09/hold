// New suppliers end to end through the real intake, Maya's confirmation and a check call, with
// Claude scripted: an email "is a bill" when it mentions an invoice, and the fraud playbook only
// flags gift-card requests.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

vi.mock("./techniques.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./techniques.js")>();
  const client = {
    messages: {
      parse: async (req: { system: string; messages: { content: string }[] }) => {
        const content = req.messages[0]!.content.toLowerCase();
        if (req.system.includes("no record of")) {
          return { stop_reason: "end_turn", parsed_output: { isBill: content.includes("invoice"), companyName: "Lumen Stage Lighting", contactName: "Ana Ruiz", whatFor: "stage lighting rental" } };
        }
        const suspicious = content.includes("gift card");
        return { stop_reason: "end_turn", parsed_output: { matches: [], novel: { suspicious, name: suspicious ? "Gift cards" : "", quote: "", why: suspicious ? "Asks for gift cards." : "" } } };
      },
    },
  };
  return { ...real, anthropic: () => client };
});

const SECRET = "test-secret-0123456789";
const STAGE = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};
const INVOICE = "Hi Fogline, attached is invoice #L-104 for the stage lighting rental, $2,400.00. Questions? Call me at (628) 555-0143. Ana Ruiz, Lumen Stage Lighting";
const NOTE = { hiredFor: "Main-stage lighting rig for the festival weekend", agreed: "Quote of $2,400 for three days", dates: "Nov 6 to Nov 8", foglineContact: "Priya, production" };

async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("suppliers", STAGE));
  return t;
}
const send = (t: ReturnType<typeof convexTest>, from: string, subject: string, body: string) =>
  t.action(api.app.intake.ingestEmail, { from, subject, body, receivedAt: "2026-10-24T10:00:00.000Z" });
const suppliers = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("suppliers").collect());
const bills = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("bills").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOICE_SERVER_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a bill from a company Fogline doesn't know", () => {
  test("becomes a New supplier with its first bill waiting for Maya, and shows up in the lists", async () => {
    const t = await setup();
    const r = await send(t, "Ana Ruiz <ana@lumenstage.com>", "Invoice L-104", INVOICE);
    expect(r.status).toBe("Needs you");

    const lumen = (await suppliers(t)).find((s) => s.domain === "lumenstage.com")!;
    expect(lumen).toMatchObject({ name: "Lumen Stage Lighting", contactName: "Ana Ruiz", status: "new", trustedPhone: "" });
    expect(lumen.onboarding).toMatchObject({ source: "email", emailPhones: ["+16285550143"] });

    const [bill] = (await bills(t)).filter((b) => b.supplierKey === lumen.key);
    expect(bill).toMatchObject({ status: "Needs you", bankAccountKey: "", amountCents: 240_000 });
    expect(bill!.checks!.find((c: { id: string }) => c.id === "new-supplier")!.state).toBe("flag");
    // It renders in the bill lists and on the Suppliers screen.
    expect((await t.query(api.app.queries.listBills, {})).some((b) => b.key === bill!.key)).toBe(true);
    expect((await t.query(api.app.queries.getSupplier, { key: lumen.key }))?.onboarding?.emailPhones).toEqual(["+16285550143"]);
  });

  test("a second bill from the same newcomer joins the same supplier", async () => {
    const t = await setup();
    await send(t, "ana@lumenstage.com", "Invoice L-104", INVOICE);
    await send(t, "ana@lumenstage.com", "Invoice L-105", INVOICE.replace("L-104", "L-105").replace("(628) 555-0143", "(628) 555-0199"));
    const lumen = (await suppliers(t)).filter((s) => s.domain === "lumenstage.com");
    expect(lumen).toHaveLength(1);
    expect(lumen[0]!.onboarding!.emailPhones).toEqual(["+16285550143", "+16285550199"]);
    expect((await bills(t)).filter((b) => b.supplierKey === lumen[0]!.key)).toHaveLength(2);
  });

  test("a look-alike of a known supplier's domain is a scam, never a new supplier", async () => {
    const t = await setup();
    await send(t, "rosa@stagecraft-rigging.co", "Invoice 4502", "Invoice #4502, $18,400.00. We moved banks.");
    expect(await suppliers(t)).toHaveLength(1);
    const [bill] = await bills(t);
    expect(bill!.supplierKey).toBe("unknown:stagecraft-rigging.co");
    expect(bill!.checks![0]).toMatchObject({ id: "domain", label: "Look-alike domain", state: "flag" });
    expect(bill!.checks![0]!.evidence).toContain("Stagecraft Rigging Co.");
  });

  test("a newcomer's email the fraud playbook flags isn't onboarded", async () => {
    const t = await setup();
    await send(t, "billing@quickvendor.io", "Invoice 9", "Invoice #9 for $900.00. Please pay with gift cards today.");
    expect(await suppliers(t)).toHaveLength(1);
    expect((await bills(t))[0]!.checks![0]).toMatchObject({ id: "fraud-technique", state: "flag" });
  });

  test("a newcomer's email that isn't a bill is a message for Maya, with no supplier made", async () => {
    const t = await setup();
    const r = await send(t, "hello@lumenstage.com", "Intro", "Hi! We rent stage lighting and would love to work with Fogline.");
    expect(r.status).toBe("Needs you");
    expect(await suppliers(t)).toHaveLength(1);
    expect((await t.query(api.app.triage.messages, {})).open[0]).toMatchObject({ subject: "Intro" });
  });
});

describe("Maya confirms a new supplier, then hold calls them", () => {
  async function onboarded() {
    const t = await setup();
    await send(t, "Ana Ruiz <ana@lumenstage.com>", "Invoice L-104", INVOICE);
    const lumen = (await suppliers(t)).find((s) => s.domain === "lumenstage.com")!;
    return { t, key: lumen.key };
  }

  test("the number from the supplier's own email can never be the trusted number", async () => {
    const { t, key } = await onboarded();
    await expect(t.mutation(api.app.onboarding.confirmNewSupplier, { supplierKey: key, trustedPhone: "628-555-0143", note: NOTE, actor: "maya" })).rejects.toThrow("supplier's own email");
  });

  test("Callback can't confirm a supplier, and Maya must say what Fogline hired them for", async () => {
    const { t, key } = await onboarded();
    await expect(t.mutation(api.app.onboarding.confirmNewSupplier, { supplierKey: key, trustedPhone: "4155550123", note: NOTE, actor: "callback" })).rejects.toThrow("Maya or Dev");
    await expect(t.mutation(api.app.onboarding.confirmNewSupplier, { supplierKey: key, trustedPhone: "4155550123", note: { ...NOTE, hiredFor: " " }, actor: "maya" })).rejects.toThrow("hired them for");
  });

  test("confirming queues a check call on the background check's number for each waiting bill", async () => {
    const { t, key } = await onboarded();
    await t.run((ctx) =>
      ctx.db.insert("backgroundChecks", { key: "bg_1", kind: "background", supplierKey: key, domain: "lumenstage.com", ranAt: "2026-10-24", findings: [], suggestedPhone: "(415) 555-0188" }),
    );
    expect(await t.mutation(api.app.onboarding.confirmNewSupplier, { supplierKey: key, trustedPhone: "415-555-0188", note: NOTE, actor: "maya" })).toEqual({ calls: 1 });

    const lumen = (await suppliers(t)).find((s) => s.key === key)!;
    expect(lumen).toMatchObject({ trustedPhone: "+14155550188", status: "new", onboarding: { note: NOTE, confirmedBy: "maya" } });
    const [call] = await t.run((ctx) => ctx.db.query("callRequests").collect());
    expect(call).toMatchObject({ supplier_id: key, to_number: "+14155550188", number_source: "background_check", status: "queued" });
    expect((await bills(t)).find((b) => b.supplierKey === key)!.status).toBe("Calling");
  });

  test("a confirmed call makes them Trusted and sends the first payment to Dev", async () => {
    const { t, key } = await onboarded();
    await t.mutation(api.app.onboarding.confirmNewSupplier, { supplierKey: key, trustedPhone: "4155550123", note: NOTE, actor: "maya" });
    const [call] = await t.run((ctx) => ctx.db.query("callRequests").collect());
    expect(call!.number_source).toBe("on_file"); // Maya's own records, not the background check
    await t.mutation(api.voice.server.finishCall, { secret: SECRET, result: { call_id: call!.call_id, outcome: "confirmed", evidence: [], summary: "Ana confirmed the lighting rig and the quote." } });
    // Runs the bill update, and the background check onboarding started (offline here).
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.unstubAllGlobals();

    expect((await suppliers(t)).find((s) => s.key === key)!.status).toBe("trusted");
    expect((await bills(t)).find((b) => b.supplierKey === key)!.status).toBe("Needs you");
    const [approval] = await t.run((ctx) => ctx.db.query("approvals").collect());
    expect(approval).toMatchObject({ routedTo: "dev", status: "pending" });
    expect(approval!.reason).toContain("new supplier");
  });
});
