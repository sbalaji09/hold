// The Inbox ledger mixes bills and supplier messages: which rows each view shows, newest first.
import { describe, expect, test } from "vitest";
import { inboxItems, parseView } from "./inbox";

const bills = [
  { key: "b1", status: "Paid" as const, receivedAt: "2026-10-20T10:00:00Z" },
  { key: "b2", status: "Held" as const, receivedAt: "2026-10-22T10:00:00Z" },
];
const messages = {
  open: [{ key: "m1", receivedAt: "2026-10-21T10:00:00Z" }],
  done: [{ key: "m2", receivedAt: "2026-10-19T10:00:00Z" }],
  filed: [{ key: "m3", receivedAt: "2026-10-23T10:00:00Z" }],
};
const keys = (items: ReturnType<typeof inboxItems<(typeof bills)[number], (typeof messages.open)[number]>>) =>
  items.map((i) => (i.kind === "bill" ? i.bill.key : i.message.key));

describe("inbox items", () => {
  test("All is every bill plus open messages, newest first", () => {
    expect(keys(inboxItems(bills, messages, undefined))).toEqual(["b2", "m1", "b1"]);
  });
  test("a status shows only bills; Messages only open messages; filed shows done and filed", () => {
    expect(keys(inboxItems(bills, messages, "Held"))).toEqual(["b2"]);
    expect(keys(inboxItems(bills, messages, "messages"))).toEqual(["m1"]);
    expect(keys(inboxItems(bills, messages, "filed"))).toEqual(["m3", "m2"]);
  });
  test("unknown views fall back to All", () => {
    expect(parseView("filed")).toBe("filed");
    expect(parseView("Needs you")).toBe("Needs you");
    expect(parseView("nope")).toBeUndefined();
  });
});
