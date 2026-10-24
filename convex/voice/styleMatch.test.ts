import { afterEach, expect, test, vi } from "vitest";
import { SUPPLIER_INDEX } from "../../shared/search.js";
import { emailsFromMoss, orderReasons, pickEmails } from "./styleMatch.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const doc = (supplier_id: string, id: string, kind: string, date: string) => ({
  id: `${supplier_id}:${id}`,
  text: `text of ${id}`,
  metadata: { supplier_id, id, kind, ref: `Email ${date}`, date },
});

test("reads only this supplier's emails from the shared Moss index", async () => {
  vi.stubEnv("MOSS_PROJECT_ID", "proj");
  vi.stubEnv("MOSS_PROJECT_KEY", "key");
  const fetchMock = vi.fn(async () =>
    Response.json([
      doc("sup_stage", "email_1", "email", "2026-09-01"),
      doc("sup_stage", "bill_1", "invoice", "2026-09-01"),
      doc("sup_bayview_staging", "email_2", "email", "2026-09-02"),
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const emails = await emailsFromMoss("sup_stage");
  expect(emails?.map((e) => e.id)).toEqual(["email_1"]);
  expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({
    action: "getDocs",
    indexName: SUPPLIER_INDEX,
  });
});

test("returns null (fall back to Convex) when Moss is unconfigured or failing", async () => {
  vi.stubEnv("MOSS_PROJECT_ID", "");
  expect(await emailsFromMoss("sup_stage")).toBeNull();
  vi.stubEnv("MOSS_PROJECT_ID", "proj");
  vi.stubEnv("MOSS_PROJECT_KEY", "key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(await emailsFromMoss("sup_stage")).toBeNull();
});

test("pickEmails keeps the 14 most recent and drops the email under test", () => {
  const all = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    supplier_id: "s",
    kind: "email" as const,
    ref: "",
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    text: `body ${i}`,
  }));
  const picked = pickEmails(all, "body 19");
  expect(picked).toHaveLength(14);
  expect(picked[0]!.id).toBe("e18");
});

test("a mismatch leads with a difference, so the bill page never explains a failed check with a similarity", () => {
  const verdict = {
    score: 0.5,
    differences: ["Past emails write amounts as '18,400 USD'; this one uses '$18,400.00'."],
    similarities: ["Greeting 'Hi team,' and sign-off 'Thanks,' match past emails."],
  };
  expect(orderReasons({ ...verdict, matches: false })[0]).toContain("'18,400 USD'");
  expect(orderReasons({ ...verdict, matches: true })[0]).toContain("Greeting 'Hi team,'");
});
