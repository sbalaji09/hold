import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SupplierRecord } from "./contract.js";

const moss = vi.hoisted(() => ({
  loadIndex: vi.fn(async (name: string) => name),
  query: vi.fn(),
  listIndexes: vi.fn(async () => [] as { name: string }[]),
  deleteIndex: vi.fn(async () => true),
  createIndex: vi.fn(async () => ({ jobId: "j", indexName: "i", docCount: 0 })),
  getDocs: vi.fn(async () => [] as { id: string; text: string }[]),
  deleteDocs: vi.fn(async () => ({ jobId: "j", indexName: "i", docCount: 0 })),
  addDocs: vi.fn(async () => ({ jobId: "j", indexName: "i", docCount: 0 })),
}));
vi.mock("@inferedge/moss", () => ({
  MossClient: vi.fn(function () {
    return moss;
  }),
}));

const { MossSearch, fromMossDoc, toMossDoc } = await import("./mossSearch.js");
const { SUPPLIER_INDEX } = await import("./search.js");

const invoice: SupplierRecord = {
  id: "bill_4471",
  supplier_id: "sup_stage",
  kind: "invoice",
  ref: "#4471",
  date: "2026-09-01",
  text: "September 2026 invoice #4471 for main-stage truss rental. Total $18,400.00.",
  amount_cents: 1840000,
};
const otherSupplier: SupplierRecord = { ...invoice, id: "bill_4001", supplier_id: "sup_bayview_staging", ref: "#4001" };

beforeEach(() => vi.clearAllMocks());

describe("MossSearch (one shared index)", () => {
  test("record <-> Moss document round trip, with supplier-prefixed ids", () => {
    expect(toMossDoc(invoice).id).toBe("sup_stage:bill_4471");
    expect(fromMossDoc(toMossDoc(invoice))).toEqual(invoice);
    expect(fromMossDoc({ id: "x", text: "t", metadata: { kind: "bogus", id: "x", supplier_id: "s" } })).toBeNull();
    expect(fromMossDoc({ id: "x", text: "t", metadata: { kind: "invoice", id: "x" } })).toBeNull();
  });

  test("concurrent warms for different suppliers share one load of the shared index", async () => {
    const s = new MossSearch("p", "k");
    await Promise.all([s.warm("sup_stage"), s.warm("sup_bayview_staging"), s.warm("sup_stage")]);
    expect(moss.loadIndex).toHaveBeenCalledTimes(1);
    expect(moss.loadIndex).toHaveBeenCalledWith(SUPPLIER_INDEX);
  });

  test("search always filters by supplier and kind, and never returns another supplier's records", async () => {
    const s = new MossSearch("p", "k");
    const email = { ...toMossDoc({ ...invoice, id: "email_1", kind: "email" }), score: 0.5 };
    // Even if Moss returned other suppliers' or kinds' docs, none leak through.
    moss.query.mockResolvedValueOnce({
      query: "q",
      docs: [{ ...toMossDoc(invoice), score: 0.9 }, { ...toMossDoc(otherSupplier), score: 0.95 }, email],
    });
    const hits = await s.search("sup_stage", "september total", { topK: 3, kinds: ["invoice"] });
    expect(moss.query).toHaveBeenCalledWith(SUPPLIER_INDEX, "september total", {
      topK: 3,
      filter: {
        $and: [
          { field: "supplier_id", condition: { $eq: "sup_stage" } },
          { field: "kind", condition: { $eq: "invoice" } },
        ],
      },
    });
    expect(hits).toEqual([{ record: invoice, score: 0.9 }]);

    moss.query.mockResolvedValueOnce({ query: "q", docs: [{ ...toMossDoc(otherSupplier), score: 0.9 }] });
    expect(await s.search("sup_stage", "anything")).toEqual([]);
    expect(moss.query.mock.calls[1]![2]).toEqual({
      topK: 5,
      filter: { field: "supplier_id", condition: { $eq: "sup_stage" } },
    });
    expect(moss.loadIndex).toHaveBeenCalledTimes(1);
  });

  test("a failed warm is retried next time", async () => {
    const s = new MossSearch("p", "k");
    moss.loadIndex.mockRejectedValueOnce(new Error("network"));
    await expect(s.warm("sup_stage")).rejects.toThrow("network");
    await s.warm("sup_stage");
    expect(moss.loadIndex).toHaveBeenCalledTimes(2);
  });

  test("index creates the shared index when it doesn't exist yet", async () => {
    const s = new MossSearch("p", "k");
    await s.index("sup_stage", [invoice]);
    expect(moss.createIndex).toHaveBeenCalledWith(SUPPLIER_INDEX, [toMossDoc(invoice)]);
    expect(moss.deleteIndex).not.toHaveBeenCalled();
  });

  test("index replaces only that supplier's docs, deletes its stale ones, and reloads if warm", async () => {
    const s = new MossSearch("p", "k");
    await s.warm();
    moss.listIndexes.mockResolvedValueOnce([{ name: SUPPLIER_INDEX }]);
    moss.getDocs.mockResolvedValueOnce([
      { id: "sup_stage:bill_4471", text: "" },
      { id: "sup_stage:bill_old", text: "" },
      { id: "sup_bayview_staging:bill_4001", text: "" },
      { id: "sup_stage_annex:bill_9", text: "" }, // shares a name prefix but is another supplier
    ]);
    await s.index("sup_stage", [invoice]);
    expect(moss.deleteIndex).not.toHaveBeenCalled();
    expect(moss.deleteDocs).toHaveBeenCalledWith(SUPPLIER_INDEX, ["sup_stage:bill_old"]);
    expect(moss.addDocs).toHaveBeenCalledWith(SUPPLIER_INDEX, [toMossDoc(invoice)], { upsert: true });
    expect(moss.loadIndex).toHaveBeenCalledTimes(2);
  });

  test("index refuses records from another supplier", () => {
    const s = new MossSearch("p", "k");
    expect(() => s.index("sup_stage", [invoice, otherSupplier])).toThrow(/another supplier/);
  });

  test("indexAll rebuilds the shared index in one job", async () => {
    const s = new MossSearch("p", "k");
    moss.listIndexes.mockResolvedValueOnce([{ name: SUPPLIER_INDEX }, { name: "product-search-context" }]);
    await s.indexAll([invoice, otherSupplier]);
    expect(moss.deleteIndex).toHaveBeenCalledTimes(1);
    expect(moss.deleteIndex).toHaveBeenCalledWith(SUPPLIER_INDEX);
    expect(moss.createIndex).toHaveBeenCalledWith(SUPPLIER_INDEX, [toMossDoc(invoice), toMossDoc(otherSupplier)]);
  });
});
