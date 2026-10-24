import { describe, expect, test } from "vitest";
import { routeEmail, SEED_EMAIL_KINDS, SEED_PRACTICE_EMAILS, type EmailKind } from "./triage";

const kinds: EmailKind[] = SEED_EMAIL_KINDS.map((k, i) => ({ ...k, key: `kind_${i}` }));
const keyOf = (name: string) => kinds.find((k) => k.name === name)!.key;
const judged = (name: string) => ({ kindKey: keyOf(name), why: "Because", quote: "" });
const clean = { hasAmount: false, fraudFlagged: false };

describe("routeEmail", () => {
  test("follows the kind's route for an ordinary email", () => {
    expect(routeEmail(judged("Schedule or logistics update"), kinds, clean)).toMatchObject({ route: "to_maya", kindName: "Schedule or logistics update" });
    expect(routeEmail(judged("Document for the file"), kinds, clean).route).toBe("file");
    expect(routeEmail(judged("Invoice"), kinds, { hasAmount: true, fraudFlagged: false }).route).toBe("bill");
  });

  test("anything a fraud check flags goes through the bill checks, whatever kind it looks like", () => {
    const r = routeEmail(judged("Document for the file"), kinds, { hasAmount: false, fraudFlagged: true });
    expect(r.route).toBe("bill");
    expect(r.why).toContain("fraud check flagged it");
  });

  test("an invoice with no amount goes to Maya instead of becoming a $0 bill", () => {
    expect(routeEmail(judged("Invoice"), kinds, clean)).toMatchObject({ route: "to_maya" });
  });

  test("an email that mentions money is never filed away unseen", () => {
    expect(routeEmail(judged("Newsletter or announcement"), kinds, { hasAmount: true, fraudFlagged: false }).route).toBe("to_maya");
  });

  test("a kind hold doesn't know goes to Maya with the reason", () => {
    const r = routeEmail({ kindKey: "", why: "", quote: "" }, kinds, clean);
    expect(r).toMatchObject({ route: "to_maya", kindName: "Unknown kind" });
    expect(r.why).toContain("doesn't match any kind");
  });
});

test("the starting kinds and practice emails are distinct and cover every route", () => {
  expect(new Set(SEED_EMAIL_KINDS.map((k) => k.name)).size).toBe(SEED_EMAIL_KINDS.length);
  expect(new Set(SEED_EMAIL_KINDS.map((k) => k.route))).toEqual(new Set(["bill", "to_maya", "file"]));
  expect(new Set(SEED_PRACTICE_EMAILS.map((e) => e.expected))).toEqual(new Set(["bill", "to_maya", "file"]));
});
