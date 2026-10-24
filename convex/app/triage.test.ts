// Inbox triage (job #2) end to end through intake, Maya's corrections and the shared loop engine,
// with Claude scripted: an email is the last kind any of whose signals appear in it, and fraud
// assessment finds nothing (the regex checks still run for real).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";
import { modules } from "../test.setup.js";

const fake = vi.hoisted(() => ({ proposals: [] as unknown[] }));

vi.mock("./techniques.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./techniques.js")>();
  const client = {
    messages: {
      parse: async (req: { system: string; messages: { content: string }[] }) => {
        if (req.system.includes("You maintain hold's playbook")) return { stop_reason: "end_turn", parsed_output: fake.proposals.shift() };
        const content = req.messages[0]!.content;
        if (req.system.includes("You sort emails")) {
          const body = (/<email[^>]*>\n([\s\S]*)\n<\/email>/.exec(content)?.[1] ?? "").toLowerCase();
          const hits = [...content.matchAll(/<kind key="([^"]+)"[^>]*>[\s\S]*?Signals: ([^<]*)<\/kind>/g)].filter(([, , sig]) =>
            sig!.split("; ").some((s) => body.includes(s.toLowerCase())),
          );
          return { stop_reason: "end_turn", parsed_output: { kindKey: hits.at(-1)?.[1] ?? "", quote: "", why: "Scripted" } };
        }
        return { stop_reason: "end_turn", parsed_output: { matches: [], novel: { suspicious: false, name: "", quote: "", why: "" } } };
      },
    },
  };
  return { ...real, anthropic: () => client };
});

const SUPPLIER = {
  key: "sup_stage",
  name: "Stagecraft Rigging Co.",
  category: "stage" as const,
  domain: "stagecraftrigging.com",
  contactName: "Rosa Quintero",
  contactEmail: "rosa@stagecraftrigging.com",
  trustedPhone: "+14155550100",
  phoneLastCheckedAt: "2026-09-19",
};
const kind = (name: string, signal: string, route: "bill" | "to_maya" | "file") => ({
  key: `kind_${name}`,
  name,
  job: "triage" as const,
  route,
  howItWorks: name,
  signals: [signal],
  example: "",
  status: "active" as const,
  sourceKind: "seed" as const,
  createdAt: "2026-10-01",
});
const FROM = "Rosa Quintero <rosa@stagecraftrigging.com>";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("suppliers", SUPPLIER);
    await ctx.db.insert("bankAccounts", { key: "bank_stage", supplierKey: "sup_stage", bank: "Chase", last4: "2210", routingLast4: "9527", status: "active", verifiedBy: "onboarding", addedAt: "2025-01-01" });
    for (const n of [4101, 4102]) {
      await ctx.db.insert("emails", { key: `email_${n}`, billKey: `bill_${n}`, fromAddress: "rosa@stagecraftrigging.com", fromDomain: "stagecraftrigging.com", subject: `Invoice ${n}`, body: `Attached is invoice ${n} for rigging labor, $1,000.00. Kindly remit.`, receivedAt: "2026-09-01T00:00:00.000Z", direction: "in" });
      await ctx.db.insert("bills", { key: `bill_${n}`, supplierKey: "sup_stage", invoiceNo: `${n}`, amountCents: 100_000, currency: "USD", dueDate: "2026-09-15", receivedAt: "2026-09-01T00:00:00.000Z", bankAccountKey: "bank_stage", status: "Paid", emailKey: `email_${n}`, planted: false });
    }
    await ctx.db.insert("fraudTechniques", kind("Invoice", "invoice", "bill"));
    await ctx.db.insert("fraudTechniques", kind("Schedule update", "load-in", "to_maya"));
    await ctx.db.insert("fraudTechniques", kind("Document", "certificate", "file"));
    await ctx.db.insert("practiceEmails", { key: "pmail_1", kind: "Document", text: "Our insurance certificate for your records.", expected: "file", source: "seed" });
  });
  return t;
}

const ingest = (t: ReturnType<typeof convexTest>, subject: string, body: string) =>
  t.action(api.app.intake.ingestEmail, { from: FROM, subject, body, receivedAt: "2026-10-24T10:00:00.000Z" });
const bills = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("bills").collect()).then((b) => b.filter((x) => !["bill_4101", "bill_4102"].includes(x.key)));
const email = (t: ReturnType<typeof convexTest>, subject: string) =>
  t.run((ctx) => ctx.db.query("emails").collect()).then((e) => e.find((x) => x.subject === subject)!);

beforeEach(() => {
  vi.useFakeTimers();
  fake.proposals = [];
});
afterEach(() => vi.useRealTimers());

describe("every supplier email is sorted before anything else happens", () => {
  test("a schedule update becomes a message for Maya, not a $0 bill", async () => {
    const t = await setup();
    const r = await ingest(t, "Re: load-in schedule", "The crew's load-in moves to 6am Thursday at gate C.");
    expect(r.status).toBe("Needs you");
    expect(await bills(t)).toHaveLength(0);
    expect((await email(t, "Re: load-in schedule")).triage).toMatchObject({ kindName: "Schedule update", route: "to_maya", status: "open", supplierKey: "sup_stage" });
    const inbox = await t.query(api.app.triage.messages, {});
    expect(inbox.open.map((m) => m.subject)).toEqual(["Re: load-in schedule"]);
    expect(inbox.open[0]!.supplierName).toBe("Stagecraft Rigging Co.");
  });

  test("an invoice still goes through the bill checks", async () => {
    const t = await setup();
    await ingest(t, "Invoice 4103", "Attached is invoice 4103 for rigging labor, $1,000.00. Kindly remit.");
    expect(await bills(t)).toHaveLength(1);
  });

  test("a 'document' asking to change banks can't be filed away: it goes through the bill checks", async () => {
    const t = await setup();
    await ingest(t, "Certificate", "Attached is our certificate. Also, we moved banks; please use our new account for invoice 4104, $1,000.00.");
    const [bill] = await bills(t);
    expect(bill).toBeDefined();
    expect(bill!.checks!.find((c: { id: string }) => c.id === "bank-account")!.state).toBe("flag");
  });

  test("a kind hold has never seen goes to Maya, with the reason", async () => {
    const t = await setup();
    await ingest(t, "Team dinner", "Would your accounts team like to join us for dinner after the festival?");
    expect((await email(t, "Team dinner")).triage).toMatchObject({ route: "to_maya", kindName: "Unknown kind" });
  });

  test("triage's playbook and fraud's never mix", async () => {
    const t = await setup();
    expect(await t.query(internal.app.techniques.activePlaybook, {})).toHaveLength(0);
    expect(await t.query(internal.app.techniques.activePlaybook, { job: "triage" })).toHaveLength(3);
  });
});

describe("Maya's corrections teach triage through the same loop as fraud", () => {
  test("'this is a bill' runs it through the bill checks, and hold learns a stricter kind on its own", async () => {
    const t = await setup();
    await ingest(t, "Re: load-in costs", "Re: load-in. Please pay $1,200.00 for the extra crew on Thursday.");
    const msg = await email(t, "Re: load-in costs");
    expect(msg.triage!.route).toBe("to_maya");
    fake.proposals = [{ action: "add", route: "bill", targetKey: "", name: "Extra charges", howItWorks: "A supplier asks to be paid for extra work.", signals: ["please pay"], example: "Please pay for the extra crew.", rationale: "Requests to pay for extra work are bills." }];

    await t.mutation(api.app.triage.correctMessage, { emailKey: msg.key, route: "bill", actor: "maya" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [bill] = await bills(t);
    expect(bill).toMatchObject({ emailKey: msg.key, amountCents: 120_000 }); // the same email row, now a bill
    expect((await email(t, "Re: load-in costs")).billKey).toBe(bill!.key);
    const [impr] = await t.run((ctx) => ctx.db.query("improvements").collect());
    expect(impr).toMatchObject({ job: "triage", status: "promoted", trigger: { kind: "corrected", expected: "bill", emailKey: msg.key } });
    const learned = (await t.run((ctx) => ctx.db.query("fraudTechniques").collect())).find((r) => r.name === "Extra charges");
    expect(learned).toMatchObject({ job: "triage", route: "bill", sourceKind: "corrected", status: "active" });
    const corrected = (await t.run((ctx) => ctx.db.query("practiceEmails").collect())).filter((e) => e.source === "corrected");
    expect(corrected).toMatchObject([{ expected: "bill" }]);
  });

  test("a change that files emails away waits for Maya, and Callback can't approve it", async () => {
    const t = await setup();
    await ingest(t, "Re: load-in photos", "Re: load-in. Photos from today's build for your records.");
    const msg = await email(t, "Re: load-in photos");
    fake.proposals = [{ action: "add", route: "file", targetKey: "", name: "Build photos", howItWorks: "Photos from the site.", signals: ["photos"], example: "Photos from today's build.", rationale: "Photos need no action." }];

    await t.mutation(api.app.triage.correctMessage, { emailKey: msg.key, route: "file", actor: "maya" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [impr] = await t.run((ctx) => ctx.db.query("improvements").collect());
    expect(impr!.status).toBe("needs_approval");
    await expect(t.mutation(api.app.techniques.decideImprovement, { key: impr!.key, decision: "approve", actor: "callback" })).rejects.toThrow("Maya or Dev");
    await t.mutation(api.app.techniques.decideImprovement, { key: impr!.key, decision: "approve", actor: "maya" });
    expect((await t.run((ctx) => ctx.db.query("fraudTechniques").collect())).find((r) => r.name === "Build photos")).toMatchObject({ job: "triage", route: "file", status: "active" });
  });

  test("'not a bill' on a bill holds it so it can't be paid, and hold learns", async () => {
    const t = await setup();
    await ingest(t, "Invoice 4105", "Attached is invoice 4105 for rigging labor, $1,000.00. Kindly remit.");
    const [bill] = await bills(t);
    await t.mutation(api.app.triage.notABill, { billKey: bill!.key, route: "to_maya", actor: "dev" });
    expect((await bills(t))[0]!.status).toBe("Held");
    const [impr] = await t.run((ctx) => ctx.db.query("improvements").collect());
    expect(impr).toMatchObject({ job: "triage", trigger: { kind: "corrected", expected: "to_maya", by: "dev" } });
    // The email now waits in Maya's messages, and remembers who corrected it.
    const inbox = await t.query(api.app.triage.messages, {});
    expect(inbox.open.map((m) => m.subject)).toEqual(["Invoice 4105"]);
    expect(inbox.open[0]!.triage).toMatchObject({ correctedRoute: "to_maya", correctedBy: "dev" });
    expect(await t.query(api.app.triage.getMessage, { emailKey: bill!.emailKey })).toMatchObject({ subject: "Invoice 4105", supplierName: "Stagecraft Rigging Co." });
    expect(await t.query(api.app.triage.getMessage, { emailKey: "email_4101" })).toBeNull(); // a plain bill email isn't a message
  });
});
