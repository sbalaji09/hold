// The Suppliers graph: who links to whom, and the two red links (look-alike sender, shared account).
import { describe, expect, test } from "vitest";
import { buildSupplierGraph } from "./supplierGraph";
import type { Bill, Supplier } from "./types";

const sup = (key: string, category: Supplier["category"], domain: string) =>
  ({ key, name: key, category, domain, contactName: "", contactEmail: "", trustedPhone: "", phoneLastCheckedAt: "", openItems: 0 }) as Supplier & { openItems: number };

const bill = (supplier: Supplier, fromDomain: string, bank: string, last4: string, status: Bill["status"] = "Paid") =>
  ({
    key: `b-${supplier.key}-${last4}`,
    supplier,
    status,
    amountCents: 1000,
    receivedAt: "2026-10-01T00:00:00Z",
    email: { fromDomain },
    bankAccount: { key: `${bank}-${last4}`, bank, last4, addedAt: "2026-01-01" },
  }) as unknown as Bill;

describe("supplier graph", () => {
  const stage = sup("stage", "stage", "stage.com");
  const truss = sup("truss", "stage", "truss.com");
  const tacos = sup("tacos", "food", "tacos.com");
  const g = buildSupplierGraph(
    [stage, truss, tacos],
    [bill(stage, "stage.com", "Chase", "2210"), bill(truss, "tru-ss.com", "Mercury", "8817", "Held"), bill(tacos, "tacos.com", "Mercury", "8817")],
  );
  const edge = (kind: string) => g.edges.filter((e) => e.kind === kind).map((e) => `${e.from}>${e.to}`);

  test("every supplier hangs off its category, every category off Fogline", () => {
    expect(edge("supplier").sort()).toEqual(["cat:food>tacos", "cat:stage>stage", "cat:stage>truss"]);
    expect(edge("category").sort()).toEqual(["fogline>cat:food", "fogline>cat:stage"]);
  });

  test("a sender domain that isn't the supplier's becomes a look-alike node", () => {
    expect(edge("lookalike")).toEqual(["look:tru-ss.com>truss"]);
  });

  test("two suppliers asking for one account are linked, and each knows it", () => {
    expect(edge("shared_account")).toEqual(["tacos>truss"]);
    const truss = g.nodes.find((n) => n.id === "truss");
    expect(truss?.kind === "supplier" && truss.facts.sharesAccountWith).toEqual([{ supplierKey: "tacos", account: "Mercury ··8817" }]);
    expect(truss?.kind === "supplier" && truss.facts.held).toBe(1);
  });

  test("bills with no account on file (new suppliers) don't link suppliers or list an account", () => {
    const a = sup("a", "other", "a.com");
    const b = sup("b", "other", "b.com");
    const none = (s: Supplier) => ({ ...bill(s, s.domain, "Not on file", "----", "Needs you"), bankAccount: { key: "", bank: "Not on file", last4: "----", addedAt: "" } }) as Bill;
    const g2 = buildSupplierGraph([a, b], [none(a), none(b)]);
    expect(g2.edges.filter((e) => e.kind === "shared_account")).toEqual([]);
    const node = g2.nodes.find((n) => n.id === "a");
    expect(node?.kind === "supplier" && node.facts.accounts).toEqual([]);
    expect(node?.kind === "supplier" && node.facts.bills).toBe(1);
  });
});
