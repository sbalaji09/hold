import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierRecord } from "../../shared/contract.js";
import { FakeSearch, STAGE, STAGE_RECORDS } from "./call/testing.js";
import { keepMemoryCurrent } from "./memory.js";
import { MemoryStore } from "./store/memoryStore.js";

const NEW_EMAIL: SupplierRecord = { id: "email_4502", supplier_id: "sup_stage", kind: "email", ref: "Email 24 Oct", date: "2026-10-24", text: "Invoice #4502 attached. Rosa" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("keepMemoryCurrent", () => {
  it("leaves a supplier Moss already has alone, then re-indexes it once when its history changes", async () => {
    const store = new MemoryStore({ suppliers: [STAGE], records: STAGE_RECORDS });
    const search = new FakeSearch(STAGE_RECORDS);
    keepMemoryCurrent(store, search, 2_000);
    await vi.runAllTimersAsync();
    expect(search.indexed).toEqual([]);

    store.addRecord(NEW_EMAIL);
    store.addRecord({ ...NEW_EMAIL, id: "email_4503" }); // a burst re-indexes once
    await vi.runAllTimersAsync();
    expect(search.indexed).toHaveLength(1);
    expect(search.indexed[0]!.supplier_id).toBe("sup_stage");
    expect(search.indexed[0]!.records.map((r) => r.id)).toEqual(expect.arrayContaining(["email_4502", "email_4503", "bill_4471"]));
  });

  it("on startup, catches up a supplier Moss is behind on", async () => {
    const store = new MemoryStore({ suppliers: [STAGE], records: [...STAGE_RECORDS, NEW_EMAIL] });
    const search = new FakeSearch(STAGE_RECORDS);
    keepMemoryCurrent(store, search, 2_000);
    await vi.runAllTimersAsync();
    expect(search.indexed.map((i) => i.supplier_id)).toEqual(["sup_stage"]);
  });
});
