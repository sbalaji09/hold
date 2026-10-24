import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SupplierRecord } from "./contract.js";

const moss = vi.hoisted(() => ({
  loadIndex: vi.fn(async (name: string) => name),
  query: vi.fn(),
  listIndexes: vi.fn(async () => [] as { name: string }[]),
  deleteIndex: vi.fn(async () => true),
  createIndex: vi.fn(async () => ({ jobId: "j", indexName: "i", docCount: 0 })),
}));
vi.mock("@inferedge/moss", () => ({
  MossClient: vi.fn(function () {
    return moss;
  }),
}));

const { MossSearch, fromMossDoc, toMossDoc } = await import("./mossSearch.js");

const invoice: SupplierRecord = {
  id: "r1",
  supplier_id: "sup_stage",
  kind: "invoice",
  ref: "#4471",
  date: "2026-09-12",
  text: "Invoice #4471 total $18,450.00",
  amount_cents: 1845000,
};

beforeEach(() => vi.clearAllMocks());

describe("MossSearch", () => {
  test("record <-> Moss document round trip", () => {
    expect(fromMossDoc(toMossDoc(invoice), "sup_stage")).toEqual(invoice);
    expect(fromMossDoc({ id: "x", text: "t", metadata: { kind: "bogus" } }, "s")).toBeNull();
  });

  test("warm loads once; search filters by kind and maps hits back", async () => {
    const s = new MossSearch("p", "k");
    await Promise.all([s.warm("sup_stage"), s.warm("sup_stage")]);
    expect(moss.loadIndex).toHaveBeenCalledTimes(1);
    expect(moss.loadIndex).toHaveBeenCalledWith("fogline-sup_stage");

    const email = { ...toMossDoc({ ...invoice, id: "r2", kind: "email" }), score: 0.5 };
    moss.query.mockResolvedValueOnce({ query: "q", docs: [{ ...toMossDoc(invoice), score: 0.9 }, email] });
    const hits = await s.search("sup_stage", "september total", { topK: 3, kinds: ["invoice"] });
    expect(moss.query).toHaveBeenCalledWith("fogline-sup_stage", "september total", {
      topK: 3,
      filter: { field: "kind", condition: { $eq: "invoice" } },
    });
    expect(hits).toEqual([{ record: invoice, score: 0.9 }]); // an unfiltered email never leaks through
    expect(moss.loadIndex).toHaveBeenCalledTimes(1);
  });

  test("a failed warm is retried next time", async () => {
    const s = new MossSearch("p", "k");
    moss.loadIndex.mockRejectedValueOnce(new Error("network"));
    await expect(s.warm("sup_stage")).rejects.toThrow("network");
    await s.warm("sup_stage");
    expect(moss.loadIndex).toHaveBeenCalledTimes(2);
  });

  test("index replaces an existing index and reloads it if it was warm", async () => {
    const s = new MossSearch("p", "k");
    await s.warm("sup_stage");
    moss.listIndexes.mockResolvedValueOnce([{ name: "fogline-sup_stage" }]);
    await s.index("sup_stage", [invoice]);
    expect(moss.deleteIndex).toHaveBeenCalledWith("fogline-sup_stage");
    expect(moss.createIndex).toHaveBeenCalledWith("fogline-sup_stage", [toMossDoc(invoice)]);
    expect(moss.loadIndex).toHaveBeenCalledTimes(2);
  });

  test("index with no records only removes the index", async () => {
    const s = new MossSearch("p", "k");
    await s.index("sup_stage", []);
    expect(moss.createIndex).not.toHaveBeenCalled();
  });
});
